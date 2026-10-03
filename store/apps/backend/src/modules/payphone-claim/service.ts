import type { Context } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  InjectManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import { isAllowedClaimTransition } from "./claim-transitions"
import PayphoneClaim from "./models/payphone-claim"

const NO_ROW_WARNING = "PayPhone claim transition matched no row."
const MANUAL_REVIEW_WARNING =
  "PayPhone claim was not marked captured after an order existed. Manual review."

type PendingClaim = {
  clientTransactionId: string
  cartId: string
  amountCents: number
  currencyCode: string
}

export type PayphoneClaimRecord = {
  id: string
  clientTransactionId: string
  transactionId: string | null
  cartId: string
  status: string
  orderId: string | null
  updatedAt?: Date | string | null
}

type SqlManager = {
  getConnection: () => {
    execute: (
      query: string,
      params?: unknown[],
      method?: "all" | "get" | "run",
      ctx?: unknown
    ) => Promise<unknown>
  }
  transactional: <T>(cb: (em: SqlManager) => Promise<T>) => Promise<T>
  getTransactionContext: () => unknown
}

class PayphoneClaimModuleService extends MedusaService({
  PayphoneClaim,
}) {
  async ensurePending(input: PendingClaim): Promise<PayphoneClaimRecord> {
    const existing = await this.getByClientTransactionId(input.clientTransactionId)
    if (existing) {
      return existing
    }

    try {
      const created = await this.createPayphoneClaims({
        client_transaction_id: input.clientTransactionId,
        cart_id: input.cartId,
        amount_cents: input.amountCents,
        currency_code: input.currencyCode,
        status: "pending",
      })
      return mapEntity(created)
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      const raced = await this.getByClientTransactionId(input.clientTransactionId)
      if (!raced) {
        throw error
      }

      return raced
    }
  }

  /**
   * One caller moves pending → processing. The UPDATE is the claim.
   * A second caller gets no row and must not create an order.
   */
  @InjectManager()
  async claimProcessing(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    const rows = await runSql(
      context,
      `update "payphone_claim" set "status" = 'processing', "updated_at" = now() where "id" = ? and "status" = 'pending' and "deleted_at" is null returning *`,
      [id]
    )

    return mapSqlRow(rows[0])
  }

  @InjectManager()
  async attachTransactionId(
    id: string,
    transactionId: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<"attached" | "duplicate"> {
    try {
      const rows = await runSql(
        context,
        `update "payphone_claim" set "transaction_id" = ?, "updated_at" = now() where "id" = ? and "status" = 'processing' and ("transaction_id" is null or "transaction_id" = ?) and "deleted_at" is null returning "id"`,
        [transactionId, id, transactionId]
      )
      return rows.length ? "attached" : "duplicate"
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "duplicate"
      }

      throw error
    }
  }

  /**
   * Approved charge, no order yet. Only `processing` may enter
   * `needs_reversal`. The transaction id is written in the same statement.
   */
  @InjectManager()
  async markNeedsReversal(
    id: string,
    transactionId: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "processing",
        "needs_reversal",
        `"status" = 'needs_reversal', "transaction_id" = ?`,
        [transactionId]
      ),
      NO_ROW_WARNING
    )
  }

  /**
   * PayPhone has no such transaction, or the clientTransactionId is not ours.
   * The same statement clears transaction_id so the charge is not reversed.
   */
  @InjectManager()
  async releaseProcessing(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "processing",
        "pending",
        `"status" = 'pending', "transaction_id" = null`,
        []
      ),
      NO_ROW_WARNING
    )
  }

  @InjectManager()
  async claimReversal(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    const rows = await runSql(
      context,
      `update "payphone_claim" set "status" = 'reversing', "updated_at" = now() where "id" = ? and "status" = 'needs_reversal' and "deleted_at" is null returning *`,
      [id]
    )

    return mapSqlRow(rows[0])
  }

  @InjectManager()
  async markReversed(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "reversing",
        "reversed",
        `"status" = 'reversed'`,
        []
      ),
      NO_ROW_WARNING
    )
  }

  @InjectManager()
  async releaseReversal(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "reversing",
        "needs_reversal",
        `"status" = 'needs_reversal'`,
        []
      ),
      NO_ROW_WARNING
    )
  }

  @InjectManager()
  async listProcessingPastGrace(
    graceSeconds: number,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord[]> {
    return listStatusBefore(context, "processing", graceSeconds, true)
  }

  @InjectManager()
  async listNeedsReversal(
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord[]> {
    const rows = await runSql(
      context,
      `select * from "payphone_claim" where "status" = 'needs_reversal' and "deleted_at" is null`,
      []
    )

    return rows.flatMap((row) => {
      const mapped = mapSqlRow(row)
      return mapped ? [mapped] : []
    })
  }

  @InjectManager()
  async listStaleReversing(
    staleSeconds: number,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord[]> {
    return listStatusBefore(context, "reversing", staleSeconds, false)
  }

  @InjectManager()
  async markCaptured(
    clientTransactionId: string,
    transactionId: string,
    orderId: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<void> {
    const [claim] = await this.listPayphoneClaims({
      client_transaction_id: clientTransactionId,
    })

    if (!claim) {
      this.warn(MANUAL_REVIEW_WARNING)
      return
    }

    this.notice(
      await transitionClaim(
        context,
        claim.id,
        "processing",
        "captured",
        `"status" = 'captured', "transaction_id" = ?, "order_id" = ?`,
        [transactionId, orderId]
      ),
      orderId ? MANUAL_REVIEW_WARNING : NO_ROW_WARNING
    )
  }

  @InjectManager()
  async captureFromReversing(
    id: string,
    orderId: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "reversing",
        "captured",
        `"status" = 'captured', "order_id" = ?`,
        [orderId]
      ),
      orderId ? MANUAL_REVIEW_WARNING : NO_ROW_WARNING
    )
  }

  async getByClientTransactionId(
    clientTransactionId: string
  ): Promise<PayphoneClaimRecord | null> {
    const [claim] = await this.listPayphoneClaims({
      client_transaction_id: clientTransactionId,
    })

    return claim ? mapEntity(claim) : null
  }

  async getByTransactionId(
    transactionId: string
  ): Promise<PayphoneClaimRecord | null> {
    const [claim] = await this.listPayphoneClaims({
      transaction_id: transactionId,
    })

    return claim ? mapEntity(claim) : null
  }

  @InjectManager()
  async markRejected(
    id: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<PayphoneClaimRecord | null> {
    return this.notice(
      await transitionClaim(
        context,
        id,
        "processing",
        "rejected",
        `"status" = 'rejected'`,
        []
      ),
      NO_ROW_WARNING
    )
  }

  private notice(
    updated: PayphoneClaimRecord | null,
    emptyWarning: string
  ): PayphoneClaimRecord | null {
    if (!updated) {
      this.warn(emptyWarning)
    }

    return updated
  }

  private warn(message: string) {
    const record = this as unknown as {
      container_?: { resolve?: (key: string) => { warn?: (message: string) => void } }
      container?: { resolve?: (key: string) => { warn?: (message: string) => void } }
    }
    const container = record.container_ ?? record.container

    try {
      container?.resolve?.(ContainerRegistrationKeys.LOGGER)?.warn?.(message)
    } catch {
      return
    }
  }

}

async function transitionClaim(
  context: Context<SqlManager>,
  id: string,
  from: string,
  to: string,
  assignments: string,
  params: unknown[]
): Promise<PayphoneClaimRecord | null> {
  if (!isAllowedClaimTransition(from, to)) {
    return null
  }

  const rows = await runSql(
    context,
    `update "payphone_claim" set ${assignments}, "updated_at" = now() where "id" = ? and "status" = ? and "deleted_at" is null returning *`,
    [...params, id, from]
  )

  return mapSqlRow(rows[0])
}

async function listStatusBefore(
  context: Context<SqlManager>,
  status: "processing" | "reversing",
  ageSeconds: number,
  requireTransactionId: boolean
): Promise<PayphoneClaimRecord[]> {
  const cutoff = new Date(Date.now() - ageSeconds * 1000).toISOString()
  const transactionSql = requireTransactionId
    ? ` and "transaction_id" is not null`
    : ""
  const rows = await runSql(
    context,
    `select * from "payphone_claim" where "status" = ? and "deleted_at" is null and "updated_at" <= ?${transactionSql}`,
    [status, cutoff]
  )

  return rows.flatMap((row) => {
    const mapped = mapSqlRow(row)
    return mapped ? [mapped] : []
  })
}

async function runSql(
  context: Context<SqlManager>,
  query: string,
  params: unknown[]
): Promise<Record<string, unknown>[]> {
  const manager = requireManager(context)
  const result = await manager
    .getConnection()
    .execute(query, params, "all", manager.getTransactionContext())

  return asRows(result)
}

function requireManager(context: Context<SqlManager>): SqlManager {
  const manager = context.manager as SqlManager | undefined
  if (!manager?.getConnection || !manager.transactional) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "PayPhone claim store has no database manager."
    )
  }

  return manager
}

function asRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[]
  }

  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }

  return []
}

function mapEntity(claim: {
  id: string
  client_transaction_id: string
  transaction_id?: string | null
  cart_id: string
  status: string
  order_id?: string | null
  updated_at?: Date | string | null
}): PayphoneClaimRecord {
  return {
    id: claim.id,
    clientTransactionId: claim.client_transaction_id,
    transactionId: claim.transaction_id ?? null,
    cartId: claim.cart_id,
    status: claim.status,
    orderId: claim.order_id ?? null,
    updatedAt: claim.updated_at,
  }
}

function mapSqlRow(row: Record<string, unknown> | undefined): PayphoneClaimRecord | null {
  if (!row) {
    return null
  }

  return {
    id: String(row.id),
    clientTransactionId: String(row.client_transaction_id),
    transactionId:
      row.transaction_id == null ? null : String(row.transaction_id),
    cartId: String(row.cart_id),
    status: String(row.status),
    orderId: row.order_id == null ? null : String(row.order_id),
    updatedAt: (row.updated_at as Date | string | null) ?? null,
  }
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < 6 && current; depth++) {
    if (typeof current !== "object") {
      return false
    }

    const record = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }

    if (record.code === "23505") {
      return true
    }

    if (typeof record.message === "string") {
      const text = record.message.toLowerCase()
      if (
        text.includes("unique") ||
        text.includes("duplicate") ||
        text.includes("already exists")
      ) {
        return true
      }
    }

    current = record.cause
  }

  return false
}

export default PayphoneClaimModuleService
