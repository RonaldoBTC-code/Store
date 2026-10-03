import { PAYPHONE_PROVIDER_ID } from "./providers"

export type PayphoneCompletionSession = {
  id: string
  amount: number | string
  currency_code: string
  provider_id?: string | null
  data?: Record<string, unknown> | null
  payment_collection_id?: string | null
}

/**
 * Decides what a PayPhone redirect may do. Query params never mark an order
 * paid: the only path that can complete a cart still has to Confirm with
 * PayPhone. A cart that already has an order is returned as-is.
 */
export type PayphoneCompletionPlan =
  | { action: "reject" }
  | { action: "return_order"; orderId: string; cartId: string }
  | {
      action: "confirm_and_complete"
      cartId: string
      sessionId: string
      amount: number | string
      currencyCode: string
      data: Record<string, unknown>
      payphoneTransactionId: number
    }

export function planPayphoneCompletion(input: {
  session: PayphoneCompletionSession | undefined
  cartId: string | null
  existingOrderId: string | null
  payphoneTransactionId: number
}): PayphoneCompletionPlan {
  const session = input.session

  if (
    !session ||
    session.provider_id !== PAYPHONE_PROVIDER_ID ||
    !session.payment_collection_id ||
    !input.cartId
  ) {
    return { action: "reject" }
  }

  if (input.existingOrderId) {
    return {
      action: "return_order",
      orderId: input.existingOrderId,
      cartId: input.cartId,
    }
  }

  return {
    action: "confirm_and_complete",
    cartId: input.cartId,
    sessionId: session.id,
    amount: session.amount,
    currencyCode: session.currency_code,
    data: session.data ?? {},
    payphoneTransactionId: input.payphoneTransactionId,
  }
}
