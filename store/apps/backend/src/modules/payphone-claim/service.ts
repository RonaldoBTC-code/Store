import type { Context } from "@medusajs/framework/types"
import {
  InjectManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import PayphoneClaim from "./models/payphone-claim"

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
   * Records that an approved charge has no order. One statement, so a
   * timeout after this commit still leaves a row the reversal job can see.
   */
  @InjectManager()
  async markNeedsReversal(
    id: string,
    transactionId: string,
    @MedusaContext() context: Context<SqlManager> = {}
  ): Promise<void> {
    const manager = requireManager(context)
    await manager.transactional(async (em) => {
      await em.getConnection().execute(
        `update "payphone_claim" set "status" = 'needs_reversal', "transaction_id" = ?, "updated_at" = now() where "id" = ? and "status" in ('processing', 'needs_reversal') and "deleted_at" is null`,
        [transactionId, id],
        "run",
        em.getTransactionContext()
      )
    })
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

  async markReversed(id: string): Promise<void> {
    const [claim] = await this.listPayphoneClaims({ id })
    if (!claim || (claim.status !== "reversing" && claim.status !== "needs_reversal")) {
      return
    }

    await this.updatePayphoneClaims({
      id,
      status: "reversed",
    })
  }

  async releaseReversal(id: string): Promise<void> {
    const [claim] = await this.listPayphoneClaims({ id })
    if (!claim || claim.status !== "reversing") {
      return
    }

    await this.updatePayphoneClaims({
      id,
      status: "needs_reversal",
    })
  }

  async listReversalWork(graceSeconds: number): Promise<PayphoneClaimRecord[]> {
    const ready = await this.listPayphoneClaims({ status: "needs_reversal" })
    const processing = await this.listPayphoneClaims({ status: "processing" })
    const cutoff = Date.now() - graceSeconds * 1000

    for (const claim of processing) {
      if (!claim.transaction_id) {
        continue
      }

      const updated = new Date(claim.updated_at).getTime()
      if (updated >= cutoff) {
        continue
      }

      await this.markNeedsReversal(claim.id, String(claim.transaction_id))
    }

    const rows =
      processing.length > 0
        ? await this.listPayphoneClaims({ status: "needs_reversal" })
        : ready

    return rows.map((claim) => mapEntity(claim))
  }

  async markCaptured(
    clientTransactionId: string,
    transactionId: string,
    orderId: string
  ): Promise<void> {
    const [claim] = await this.listPayphoneClaims({
      client_transaction_id: clientTransactionId,
    })

    if (!claim) {
      return
    }

    await this.updatePayphoneClaims({
      id: claim.id,
      transaction_id: transactionId,
      order_id: orderId,
      status: "captured",
    })
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

  async markRejected(id: string): Promise<void> {
    const [claim] = await this.listPayphoneClaims({ id })
    if (!claim || claim.status === "captured" || claim.status === "reversed") {
      return
    }

    await this.updatePayphoneClaims({
      id,
      status: "rejected",
    })
  }

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
