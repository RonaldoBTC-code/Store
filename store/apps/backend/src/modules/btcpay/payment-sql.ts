import { createHash, randomBytes } from "crypto"
import { isUniqueViolation } from "./claim"
import {
  AcquireInput,
  BTCPAY_PROVIDER,
  CLOSED_PAYMENT_STATUSES,
  DEFAULT_INVOICE_TTL_MS,
  invoiceLimitBlocks,
  OPEN_PAYMENT_STATUSES,
  PaymentRecord,
  PaymentStatus,
  PERSONAL_DATA_RETENTION_MS,
} from "./limits"
import { AcquireResult } from "./payment-store"

export type SqlTx = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<Row[]>
}

export type DbManager = {
  transactional<T>(work: (manager: DbManager) => Promise<T>): Promise<T>
  execute(sql: string, params?: unknown[]): Promise<unknown>
}

type ClaimRowInput = {
  id: string
  invoiceId: string
  cartId: string
  paymentSessionHash: string | null
  amountCents: number
  currencyCode: string
}

const OPEN_STATUS_SQL = OPEN_PAYMENT_STATUSES.map((status) => `'${status}'`).join(", ")

export function sessionLockKey(sessionHash: string): string {
  return `btcpay:session:${sessionHash}`
}

export function customerLockKey(customerId: string): string {
  return `btcpay:customer:${customerId}`
}

/** Signed int8 for pg_advisory_xact_lock. Same key always maps to the same id. */
export function advisoryLockId(key: string): string {
  const hex = createHash("sha256").update(key).digest().subarray(0, 8).toString("hex")
  return BigInt.asIntN(64, BigInt(`0x${hex}`)).toString()
}

export function mikroTx(manager: DbManager): SqlTx {
  return {
    async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await manager.execute(sql, params)
      if (Array.isArray(result)) {
        return result as Row[]
      }
      if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
        return (result as { rows: Row[] }).rows
      }
      return []
    },
  }
}

export function pgTx(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}): SqlTx {
  return {
    async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query(toPgPlaceholders(sql), params)
      return result.rows as Row[]
    },
  }
}

export async function acquirePaymentSlot(
  tx: SqlTx,
  input: AcquireInput
): Promise<AcquireResult> {
  assertInteger(input.amountCents, "amount_cents")
  assertInteger(input.units, "unit_count")
  await lockAdvisory(tx, sessionLockKey(input.paymentSessionId))
  if (input.customerId) {
    await lockAdvisory(tx, customerLockKey(input.customerId))
  }
  await expireOverdueCart(tx, input)
  const replacesId = await supersedeReplacedInvoice(tx, input.replaceInvoiceId)
  const rows = await loadLimitRows(tx, input)
  if (invoiceLimitBlocks(rows, input)) {
    return { ok: false }
  }
  const id = newId("btpay")
  const expiresAt = new Date(input.now.getTime() + DEFAULT_INVOICE_TTL_MS)
  await tx.query("SAVEPOINT btcpay_payment_insert")
  try {
    await tx.query(
      `INSERT INTO "btcpay_payment" (
        "id", "provider", "status", "cart_id", "customer_id", "payment_session_hash",
        "invoice_id", "ip_hash", "unit_count", "amount_cents", "expires_at",
        "reservation_ids", "replaces_id", "created_at", "updated_at"
      ) VALUES (
        ?, ?, 'holding', ?, ?, ?,
        NULL, ?, ?, ?, ?,
        '{"ids":[]}'::jsonb, ?, ?, ?
      )`,
      [
        id,
        BTCPAY_PROVIDER,
        input.cartId,
        input.customerId,
        input.paymentSessionId,
        input.ipHash,
        input.units,
        input.amountCents,
        expiresAt,
        replacesId,
        input.now,
        input.now,
      ]
    )
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error
    }
    await tx.query("ROLLBACK TO SAVEPOINT btcpay_payment_insert")
    return { ok: false }
  }
  await tx.query("RELEASE SAVEPOINT btcpay_payment_insert")
  return { ok: true, id }
}

export async function abortHoldingPayment(tx: SqlTx, id: string): Promise<void> {
  const rows = await tx.query<{ replaces_id: string | null }>(
    `SELECT "replaces_id" FROM "btcpay_payment"
     WHERE "id" = ? AND "status" = 'holding' AND "deleted_at" IS NULL`,
    [id]
  )
  if (!rows.length) {
    return
  }
  const replacesId = rows[0].replaces_id
  await tx.query(
    `DELETE FROM "btcpay_payment" WHERE "id" = ? AND "status" = 'holding'`,
    [id]
  )
  if (!replacesId) {
    return
  }
  await tx.query(
    `UPDATE "btcpay_payment"
     SET "status" = CASE WHEN "invoice_id" IS NULL THEN 'holding' ELSE 'pending' END,
         "updated_at" = now()
     WHERE "id" = ? AND "status" = 'canceled' AND "deleted_at" IS NULL`,
    [replacesId]
  )
}

/**
 * Inserts the invoice claim and marks the payment settled.
 * A unique violation means the webhook and the return confirmation raced.
 */
export async function confirmSettlement(tx: SqlTx, input: ClaimRowInput): Promise<void> {
  assertInteger(input.amountCents, "amount_cents")
  await tx.query(
    `INSERT INTO "btcpay_invoice_claim" (
      "id", "invoice_id", "cart_id", "payment_session_hash", "amount_cents",
      "currency_code", "created_at", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?, now(), now())`,
    [
      input.id,
      input.invoiceId,
      input.cartId,
      input.paymentSessionHash,
      input.amountCents,
      input.currencyCode,
    ]
  )
  await tx.query(
    `UPDATE "btcpay_payment"
     SET "status" = 'settled', "reservation_ids" = '{"ids":[]}'::jsonb, "updated_at" = now()
     WHERE "deleted_at" IS NULL
       AND "provider" = ?
       AND "invoice_id" = ?
       AND "status" IN (${OPEN_STATUS_SQL})`,
    [BTCPAY_PROVIDER, input.invoiceId]
  )
}

export async function redactClosedPersonalData(tx: SqlTx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PERSONAL_DATA_RETENTION_MS)
  const closedSql = CLOSED_PAYMENT_STATUSES.map((status) => `'${status}'`).join(", ")
  const payments = await tx.query(
    `UPDATE "btcpay_payment"
     SET "ip_hash" = NULL,
         "payment_session_hash" = NULL,
         "updated_at" = now()
     WHERE "deleted_at" IS NULL
       AND "status" IN (${closedSql})
       AND "created_at" < ?
       AND ("ip_hash" IS NOT NULL OR "payment_session_hash" IS NOT NULL)
     RETURNING "id"`,
    [cutoff]
  )
  const claims = await tx.query(
    `UPDATE "btcpay_invoice_claim"
     SET "payment_session_hash" = NULL,
         "updated_at" = now()
     WHERE "deleted_at" IS NULL
       AND "created_at" < ?
       AND "payment_session_hash" IS NOT NULL
     RETURNING "id"`,
    [cutoff]
  )
  return payments.length + claims.length
}

export function redactionLogLine(count: number): string {
  return `BTCPay personal-data redaction updated ${count} rows.`
}

export function newPaymentId(): string {
  return newId("btpay")
}

export function newClaimId(): string {
  return newId("btclaim")
}

async function lockAdvisory(tx: SqlTx, key: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(?::bigint)`, [advisoryLockId(key)])
}

async function expireOverdueCart(tx: SqlTx, input: AcquireInput): Promise<void> {
  await tx.query(
    `UPDATE "btcpay_payment"
     SET "status" = 'expired', "updated_at" = now()
     WHERE "deleted_at" IS NULL
       AND "provider" = ?
       AND "cart_id" = ?
       AND "status" IN (${OPEN_STATUS_SQL})
       AND "expires_at" <= ?`,
    [BTCPAY_PROVIDER, input.cartId, input.now]
  )
}

async function supersedeReplacedInvoice(
  tx: SqlTx,
  replaceInvoiceId: string | undefined
): Promise<string | null> {
  if (!replaceInvoiceId) {
    return null
  }
  const rows = await tx.query<{ id: string }>(
    `UPDATE "btcpay_payment"
     SET "status" = 'canceled', "updated_at" = now()
     WHERE "deleted_at" IS NULL
       AND "provider" = ?
       AND "invoice_id" = ?
       AND "status" IN (${OPEN_STATUS_SQL})
     RETURNING "id"`,
    [BTCPAY_PROVIDER, replaceInvoiceId]
  )
  return rows[0]?.id ?? null
}

async function loadLimitRows(tx: SqlTx, input: AcquireInput): Promise<PaymentRecord[]> {
  const rows = await tx.query(
    `SELECT "id", "provider", "status", "cart_id", "customer_id", "payment_session_hash",
            "invoice_id", "ip_hash", "unit_count", "created_at", "expires_at"
     FROM "btcpay_payment"
     WHERE "deleted_at" IS NULL
       AND "provider" = ?
       AND (
         "cart_id" = ?
         OR "payment_session_hash" = ?
         OR (?::text IS NOT NULL AND "customer_id" = ?)
         OR (?::text IS NOT NULL AND "ip_hash" = ?)
       )`,
    [
      BTCPAY_PROVIDER,
      input.cartId,
      input.paymentSessionId,
      input.customerId,
      input.customerId,
      input.ipHash,
      input.ipHash,
    ]
  )
  return rows.map(mapLimitRow)
}

function mapLimitRow(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id),
    provider: String(row.provider || BTCPAY_PROVIDER),
    status: String(row.status || "pending") as PaymentStatus,
    cartId: String(row.cart_id || ""),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    paymentSessionId: row.payment_session_hash == null ? "" : String(row.payment_session_hash),
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    ipHash: row.ip_hash == null ? null : String(row.ip_hash),
    unitCount: Number(row.unit_count ?? 0),
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
    reservationIds: [],
  }
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value)
  }
  return new Date(0)
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`
}

function toPgPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => {
    index += 1
    return `$${index}`
  })
}
