import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  PayphoneClient,
  isPayphoneTransactionMissing,
  type PayphoneTransaction,
} from "../modules/payphone/client"
import { classifyTransaction } from "../modules/payphone/service"
import {
  PROCESSING_GRACE_SECONDS,
  STALE_REVERSING_SECONDS,
  payphoneReverseWindowOpen,
} from "../modules/payphone/reverse-window"
import { PAYPHONE_CLAIM_MODULE } from "../modules/payphone-claim"
import type PayphoneClaimModuleService from "../modules/payphone-claim/service"
import type { PayphoneClaimRecord } from "../modules/payphone-claim/service"

export type PayphoneQueryResult =
  | PayphoneTransaction
  | "missing"
  | "transient"

export type PayphoneReversalDeps = {
  listProcessingPastGrace: (
    graceSeconds: number
  ) => Promise<PayphoneClaimRecord[]>
  listNeedsReversal: () => Promise<PayphoneClaimRecord[]>
  listStaleReversing: (staleSeconds: number) => Promise<PayphoneClaimRecord[]>
  markNeedsReversal: (id: string, transactionId: string) => Promise<unknown>
  claimReversal: (id: string) => Promise<PayphoneClaimRecord | null>
  markReversed: (id: string) => Promise<unknown>
  releaseReversal: (id: string) => Promise<unknown>
  captureFromReversing: (
    id: string,
    orderId: string
  ) => Promise<PayphoneClaimRecord | null>
  findOrderId: (cartId: string) => Promise<string | null>
  reverse: (transactionId: number) => Promise<void>
  queryTransaction?: (row: PayphoneClaimRecord) => Promise<PayphoneQueryResult>
  reverseWindowOpen?: () => boolean
  graceSeconds?: number
  staleReversingSeconds?: number
}

/**
 * Moves expired `processing` rows to `needs_reversal`, then claims each
 * `needs_reversal` row before looking for an order. The claim is one
 * `UPDATE ... WHERE status = 'needs_reversal'`. If that order exists, the
 * row goes `reversing` → `captured` and Reverse is not called.
 * A `reversing` row older than N minutes is recovered only after PayPhone
 * answers a query.
 */
export async function retryPayphoneReversals(deps: PayphoneReversalDeps) {
  const graceSeconds = deps.graceSeconds ?? PROCESSING_GRACE_SECONDS
  const staleSeconds = deps.staleReversingSeconds ?? STALE_REVERSING_SECONDS
  const expired = await deps.listProcessingPastGrace(graceSeconds)

  for (const row of expired) {
    if (!row.transactionId) {
      continue
    }

    await deps.markNeedsReversal(row.id, row.transactionId)
  }

  const ready = await deps.listNeedsReversal()

  for (const row of ready) {
    const claimed = await deps.claimReversal(row.id)
    if (!claimed?.transactionId) {
      continue
    }

    const orderId = await deps.findOrderId(claimed.cartId)
    if (orderId) {
      await deps.captureFromReversing(claimed.id, orderId)
      continue
    }

    const transactionId = Number(claimed.transactionId)
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      await deps.releaseReversal(claimed.id)
      continue
    }

    if (deps.reverseWindowOpen && !deps.reverseWindowOpen()) {
      // TODO(contacto): Reverse solo funciona hasta las 20:00, hora de Ecuador.
      // El cobro queda en needs_reversal hasta que haya un canal de soporte.
      await deps.releaseReversal(claimed.id)
      continue
    }

    try {
      await deps.reverse(transactionId)
      await deps.markReversed(claimed.id)
    } catch {
      await deps.releaseReversal(claimed.id)
    }
  }

  const stalled = await deps.listStaleReversing(staleSeconds)

  for (const row of stalled) {
    await recoverStaleReversing(deps, row)
  }
}

async function recoverStaleReversing(
  deps: PayphoneReversalDeps,
  row: PayphoneClaimRecord
) {
  if (!deps.queryTransaction || !row.transactionId) {
    return
  }

  let queried: PayphoneQueryResult

  try {
    queried = await deps.queryTransaction(row)
  } catch {
    return
  }

  if (queried === "transient") {
    return
  }

  if (queried === "missing") {
    await deps.releaseReversal(row.id)
    return
  }

  if (
    queried.clientTransactionId &&
    queried.clientTransactionId !== row.clientTransactionId
  ) {
    await deps.releaseReversal(row.id)
    return
  }

  const orderId = await deps.findOrderId(row.cartId)
  if (orderId) {
    await deps.captureFromReversing(row.id, orderId)
    return
  }

  const outcome = classifyTransaction(queried)
  if (outcome === "cancelled" || outcome === "declined") {
    await deps.markReversed(row.id)
    return
  }

  if (outcome !== "approved") {
    await deps.releaseReversal(row.id)
    return
  }

  const transactionId = Number(row.transactionId)
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    await deps.releaseReversal(row.id)
    return
  }

  if (deps.reverseWindowOpen && !deps.reverseWindowOpen()) {
    await deps.releaseReversal(row.id)
    return
  }

  try {
    await deps.reverse(transactionId)
    await deps.markReversed(row.id)
  } catch {
    await deps.releaseReversal(row.id)
  }
}

export default async function payphoneReverseNeedsReversal(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    warn?: (message: string) => void
  }
  const client = clientFromEnv()
  if (!client) {
    return
  }

  const claims = container.resolve(
    PAYPHONE_CLAIM_MODULE
  ) as PayphoneClaimModuleService
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: (args: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    }) => Promise<{ data: unknown }>
  }

  const findOrderId = async (cartId: string) => {
    const { data } = await query.graph({
      entity: "order_cart",
      fields: ["order_id", "cart_id"],
      filters: { cart_id: cartId },
    })
    return (data as { order_id?: string }[])[0]?.order_id || null
  }

  await retryPayphoneReversals({
    listProcessingPastGrace: (graceSeconds) =>
      claims.listProcessingPastGrace(graceSeconds),
    listNeedsReversal: () => claims.listNeedsReversal(),
    listStaleReversing: (staleSeconds) => claims.listStaleReversing(staleSeconds),
    markNeedsReversal: (id, transactionId) =>
      claims.markNeedsReversal(id, transactionId),
    claimReversal: (id) => claims.claimReversal(id),
    markReversed: (id) => claims.markReversed(id),
    releaseReversal: (id) => claims.releaseReversal(id),
    captureFromReversing: (id, orderId) =>
      claims.captureFromReversing(id, orderId),
    findOrderId,
    reverse: (transactionId) => client.reverse(transactionId),
    queryTransaction: async (row) => {
      const transactionId = Number(row.transactionId)
      if (!Number.isInteger(transactionId) || transactionId <= 0) {
        return "missing"
      }

      try {
        return await client.confirm(transactionId, row.clientTransactionId)
      } catch (error) {
        if (isPayphoneTransactionMissing(error)) {
          return "missing"
        }

        return "transient"
      }
    },
    reverseWindowOpen: () => payphoneReverseWindowOpen(new Date()),
    graceSeconds: PROCESSING_GRACE_SECONDS,
    staleReversingSeconds: STALE_REVERSING_SECONDS,
  }).catch(() => {
    logger?.warn?.("PayPhone reversal job failed.")
  })
}

function clientFromEnv() {
  const token = process.env.PAYPHONE_TOKEN
  const storeId = process.env.PAYPHONE_STORE_ID
  const responseUrl = process.env.PAYPHONE_RESPONSE_URL
  const cancellationUrl = process.env.PAYPHONE_CANCELLATION_URL

  if (!token || !storeId || !responseUrl || !cancellationUrl) {
    return null
  }

  return new PayphoneClient({
    token,
    storeId,
    responseUrl,
    cancellationUrl,
  })
}

export const config = {
  name: "payphone-reverse-needs-reversal",
  schedule: "* * * * *",
}
