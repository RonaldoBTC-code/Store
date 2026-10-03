import {
  planPayphoneCompletion,
  type PayphoneCompletionSession,
} from "./completion"
import {
  classifyPayphoneMessage,
  type PayphoneShopperCode,
} from "./service"

export type PayphoneFulfillInput = {
  clientTransactionId: string
  payphoneTransactionId: number
  requestCartId?: string | null
}

export type PayphoneSettleInput = {
  cart_id: string
  request_cart_id?: string | null
  session_id: string
  amount: number | string
  currency_code: string
  data: Record<string, unknown>
  payphone_transaction_id: number
  initiated_amount_cents: number
}

export type PayphoneFulfillResult =
  | { ok: true; orderId: string; cartId: string }
  | {
      ok: false
      code: PayphoneShopperCode
      alreadySettled: boolean
      message?: string
    }

/**
 * Shared by the shopper return and the PayPhone notification.
 * An existing order is returned without Confirm. Otherwise settle runs,
 * and settle's complete callback is `completeCartWorkflow`.
 */
export async function fulfillPayphoneSale(
  deps: {
    loadSession: (
      clientTransactionId: string
    ) => Promise<PayphoneCompletionSession | undefined>
    loadCartId: (paymentCollectionId: string) => Promise<string | null>
    findOrderId: (cartId: string) => Promise<string | null>
    findClaim?: (
      clientTransactionId: string
    ) => Promise<{ status: string; orderId: string | null } | null>
    settle: (input: PayphoneSettleInput) => Promise<{ orderId: string }>
  },
  input: PayphoneFulfillInput
): Promise<PayphoneFulfillResult> {
  const session = await deps.loadSession(input.clientTransactionId)
  const cartId = session?.payment_collection_id
    ? await deps.loadCartId(session.payment_collection_id)
    : null
  const existingOrderId = cartId ? await deps.findOrderId(cartId) : null
  const plan = planPayphoneCompletion({
    session,
    cartId,
    existingOrderId,
    payphoneTransactionId: input.payphoneTransactionId,
  })

  if (plan.action === "reject") {
    return { ok: false, code: "failed", alreadySettled: false }
  }

  if (plan.action === "return_order") {
    return { ok: true, orderId: plan.orderId, cartId: plan.cartId }
  }

  const initiatedAmountCents = plan.data.amount_cents
  if (
    typeof initiatedAmountCents !== "number" ||
    !Number.isSafeInteger(initiatedAmountCents)
  ) {
    return { ok: false, code: "failed", alreadySettled: false }
  }

  try {
    const settled = await deps.settle({
      cart_id: plan.cartId,
      request_cart_id: input.requestCartId,
      session_id: plan.sessionId,
      amount: plan.amount,
      currency_code: plan.currencyCode,
      data: plan.data,
      payphone_transaction_id: plan.payphoneTransactionId,
      initiated_amount_cents: initiatedAmountCents,
    })

    if (settled.orderId) {
      return { ok: true, orderId: settled.orderId, cartId: plan.cartId }
    }

    const recovered = await deps.findOrderId(plan.cartId)
    if (recovered) {
      return { ok: true, orderId: recovered, cartId: plan.cartId }
    }

    return { ok: false, code: "failed", alreadySettled: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const code = classifyPayphoneMessage(message)

    if (code === "in_progress") {
      const recovered = await deps.findOrderId(plan.cartId)
      if (recovered) {
        return { ok: true, orderId: recovered, cartId: plan.cartId }
      }

      const claim = await deps.findClaim?.(plan.sessionId)
      if (claim?.status === "rejected") {
        return { ok: false, code: "failed", alreadySettled: true }
      }
    }

    return { ok: false, code, alreadySettled: false, message }
  }
}
