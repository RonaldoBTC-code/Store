import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PayphoneClient } from "../modules/payphone/client"
import { PAYPHONE_CLAIM_MODULE } from "../modules/payphone-claim"
import type PayphoneClaimModuleService from "../modules/payphone-claim/service"
import type { PayphoneClaimRecord } from "../modules/payphone-claim/service"

const REVERSAL_GRACE_SECONDS = 60

export type PayphoneReversalDeps = {
  listWork: (graceSeconds: number) => Promise<PayphoneClaimRecord[]>
  claimReversal: (id: string) => Promise<PayphoneClaimRecord | null>
  markReversed: (id: string) => Promise<void>
  releaseReversal: (id: string) => Promise<void>
  markCaptured: (
    clientTransactionId: string,
    transactionId: string,
    orderId: string
  ) => Promise<void>
  findOrderId: (cartId: string) => Promise<string | null>
  reverse: (transactionId: number) => Promise<void>
  graceSeconds?: number
}

/**
 * Retries PayPhone Reverse for claims in `needs_reversal`.
 * The row moves to `reversing` with one UPDATE, so two runs do not both
 * call Reverse. A failed call goes back to `needs_reversal`. A successful
 * call becomes `reversed` and is not selected again.
 * If the cart already has an order, the claim is captured and not reversed.
 */
export async function retryPayphoneReversals(deps: PayphoneReversalDeps) {
  const graceSeconds = deps.graceSeconds ?? REVERSAL_GRACE_SECONDS
  const rows = await deps.listWork(graceSeconds)

  for (const row of rows) {
    const orderId = await deps.findOrderId(row.cartId)
    if (orderId && row.transactionId) {
      await deps.markCaptured(row.clientTransactionId, row.transactionId, orderId)
      continue
    }

    const claimed = await deps.claimReversal(row.id)
    if (!claimed?.transactionId) {
      continue
    }

    const transactionId = Number(claimed.transactionId)
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
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

  await retryPayphoneReversals({
    listWork: (graceSeconds) => claims.listReversalWork(graceSeconds),
    claimReversal: (id) => claims.claimReversal(id),
    markReversed: (id) => claims.markReversed(id),
    releaseReversal: (id) => claims.releaseReversal(id),
    markCaptured: (clientTransactionId, transactionId, orderId) =>
      claims.markCaptured(clientTransactionId, transactionId, orderId),
    findOrderId: async (cartId) => {
      const { data } = await query.graph({
        entity: "order_cart",
        fields: ["order_id", "cart_id"],
        filters: { cart_id: cartId },
      })
      return (data as { order_id?: string }[])[0]?.order_id || null
    },
    reverse: (transactionId) => client.reverse(transactionId),
    graceSeconds: REVERSAL_GRACE_SECONDS,
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
