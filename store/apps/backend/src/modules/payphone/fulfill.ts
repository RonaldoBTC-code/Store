import {
  planPayphoneCompletion,
  type PayphoneCompletionSession,
} from "./completion"
import type { PayphoneChargeState } from "./return-state"
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
      charge: PayphoneChargeState
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
    return { ok: false, code: "failed", alreadySettled: false, charge: "none" }
  }

  if (plan.action === "return_order") {
    return { ok: true, orderId: plan.orderId, cartId: plan.cartId }
  }

  const initiatedAmountCents = plan.data.amount_cents
  if (
    typeof initiatedAmountCents !== "number" ||
    !Number.isSafeInteger(initiatedAmountCents)
  ) {
    return { ok: false, code: "failed", alreadySettled: false, charge: "none" }
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

    return { ok: false, code: "failed", alreadySettled: false, charge: "none" }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const code = classifyPayphoneMessage(message)
    const charge = readCharge(error)

    if (code === "in_progress") {
      const recovered = await deps.findOrderId(plan.cartId)
      if (recovered) {
        return { ok: true, orderId: recovered, cartId: plan.cartId }
      }

      const claim = await deps.findClaim?.(plan.sessionId)
      if (claim?.orderId) {
        return { ok: true, orderId: claim.orderId, cartId: plan.cartId }
      }

      const claimCharge = claim ? chargeForStatus(claim.status) : charge
      const settled =
        claim?.status === "rejected" ||
        claim?.status === "reversed" ||
        claim?.status === "needs_reversal"

      return {
        ok: false,
        code: claimCharge === "open" ? "pending" : code,
        alreadySettled: settled,
        charge: claimCharge,
        message,
      }
    }

    return { ok: false, code, alreadySettled: false, charge, message }
  }
}

function readCharge(error: unknown): PayphoneChargeState {
  if (error && typeof error === "object" && "charge" in error) {
    const charge = (error as { charge?: unknown }).charge
    if (
      charge === "none" ||
      charge === "reversal_confirmed" ||
      charge === "open"
    ) {
      return charge
    }
  }

  return "none"
}

function chargeForStatus(status: string): PayphoneChargeState {
  if (status === "reversed") {
    return "reversal_confirmed"
  }

  if (
    status === "needs_reversal" ||
    status === "reversing" ||
    status === "processing" ||
    status === "captured"
  ) {
    return "open"
  }

  return "none"
}
