import { MedusaError } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"
import {
  splitFromCartTotals,
  untaxedMajorFromCart,
} from "./amounts"
import type { PayphoneHttpClient, PayphoneTransaction } from "./client"
import {
  buildConfirmedSessionData,
  classifyTransaction,
  isServerConfirmed,
  PayphoneResultCode,
  payphoneShopperError,
  type PayphoneShopperCode,
} from "./service"

/**
 * Confirms a PayPhone return and then completes the cart.
 *
 * The unique payphone_claim row is inserted before Confirm. That insert is
 * not the same database transaction as the PayPhone HTTP call or the order
 * insert. If order creation fails after Confirm, the approved sale is
 * reversed and the claim is marked rejected. The unique row stays, so a
 * second insert of the same clientTransactionId fails instead of creating
 * a second order.
 */
export type PayphoneClaimStore = {
  insertPending(input: {
    clientTransactionId: string
    cartId: string
    amountCents: number
    currencyCode: string
  }): Promise<"claimed" | "duplicate">
  markCaptured(
    clientTransactionId: string,
    transactionId: string,
    orderId: string
  ): Promise<void>
  markRejected(clientTransactionId: string): Promise<void>
}

export type PayphoneCartSnapshot = {
  id: string
  currencyCode: string
  total: BigNumberInput
  taxTotal: BigNumberInput
  shippingTotal?: BigNumberInput | null
  shippingTaxTotal?: BigNumberInput | null
}

export type SettlePayphoneInput = {
  sessionCartId: string
  requestCartId?: string | null
  sessionId: string
  currencyCode: string
  initiatedAmountCents: number
  payphoneTransactionId: number
  sessionData: Record<string, unknown>
}

export type SettlePayphoneDeps = {
  claims: PayphoneClaimStore
  client: PayphoneHttpClient
  loadCart: (cartId: string) => Promise<PayphoneCartSnapshot | null>
  complete: (confirmed: Record<string, unknown>) => Promise<{ orderId: string }>
  logger?: { error?: (message: string) => void }
}

export async function settlePayphonePayment(
  deps: SettlePayphoneDeps,
  input: SettlePayphoneInput
): Promise<{ orderId: string; transactionId: number }> {
  if (input.requestCartId && input.requestCartId !== input.sessionCartId) {
    throw payphoneShopperError("client")
  }

  const cart = await deps.loadCart(input.sessionCartId)
  if (!cart || cart.id !== input.sessionCartId) {
    throw payphoneShopperError("client")
  }

  if (
    input.currencyCode.toLowerCase() !== "usd" ||
    cart.currencyCode.toLowerCase() !== "usd"
  ) {
    throw payphoneShopperError("currency")
  }

  const split = splitFromCartTotals({
    total: cart.total,
    taxTotal: cart.taxTotal,
    untaxedTotal: untaxedMajorFromCart({
      shipping_total: cart.shippingTotal,
      shipping_tax_total: cart.shippingTaxTotal,
    }),
  })

  if (split.amount !== input.initiatedAmountCents) {
    await reverseStoredApproval(deps, input)
    throw payphoneShopperError("cart_changed")
  }

  const claim = await deps.claims.insertPending({
    clientTransactionId: input.sessionId,
    cartId: input.sessionCartId,
    amountCents: split.amount,
    currencyCode: "usd",
  })

  if (claim === "duplicate") {
    throw payphoneShopperError("in_progress")
  }

  let transaction: PayphoneTransaction

  try {
    transaction = await confirmedTransaction(deps, input, split.amount)
  } catch (error) {
    if (error instanceof MedusaError) {
      await deps.claims.markRejected(input.sessionId)
      throw error
    }

    await deps.claims.markRejected(input.sessionId)
    throw payphoneShopperError("failed")
  }

  const outcome = classifyTransaction(transaction)
  if (outcome !== "approved") {
    await deps.claims.markRejected(input.sessionId)
    throw payphoneShopperError(outcomeCode(outcome))
  }

  const failure = confirmedMismatch(transaction, input.sessionId, split.amount)
  if (failure) {
    await reverseApproved(deps, transaction, input.sessionId)
    throw payphoneShopperError(failure)
  }

  const confirmed = buildConfirmedSessionData(
    input.sessionData,
    transaction,
    input.sessionId,
    split.amount
  )

  let orderId = ""

  try {
    const completed = await deps.complete(confirmed)
    orderId = completed.orderId
  } catch {
    deps.logger?.error?.("PayPhone order was not created after confirm.")
    await reverseApproved(deps, transaction, input.sessionId)
    throw payphoneShopperError("failed")
  }

  if (!orderId) {
    await reverseApproved(deps, transaction, input.sessionId)
    throw payphoneShopperError("failed")
  }

  try {
    await deps.claims.markCaptured(
      input.sessionId,
      String(transaction.transactionId),
      orderId
    )
  } catch {
    deps.logger?.error?.(
      "PayPhone claim stayed pending after the order was created."
    )
  }

  return {
    orderId,
    transactionId: transaction.transactionId as number,
  }
}

async function confirmedTransaction(
  deps: SettlePayphoneDeps,
  input: SettlePayphoneInput,
  amountCents: number
) {
  if (
    isServerConfirmed(
      input.sessionData,
      input.sessionId,
      input.payphoneTransactionId,
      amountCents
    )
  ) {
    return {
      amount: amountCents,
      clientTransactionId: input.sessionId,
      statusCode: 3,
      transactionStatus: "Approved",
      transactionId: input.payphoneTransactionId,
      currency: "USD",
    } satisfies PayphoneTransaction
  }

  return deps.client.confirm(input.payphoneTransactionId, input.sessionId)
}

function confirmedMismatch(
  transaction: PayphoneTransaction,
  sessionId: string,
  amountCents: number
): PayphoneShopperCode | null {
  if (transaction.clientTransactionId !== sessionId) {
    return "client"
  }

  if ((transaction.currency ?? "USD").toUpperCase() !== "USD") {
    return "currency"
  }

  if (transaction.amount !== amountCents) {
    return "amount"
  }

  return null
}

function outcomeCode(
  outcome: "cancelled" | "declined" | "pending"
): PayphoneShopperCode {
  if (outcome === "cancelled") {
    return "cancelled"
  }

  if (outcome === "pending") {
    return "pending"
  }

  return "declined"
}

async function reverseStoredApproval(
  deps: SettlePayphoneDeps,
  input: SettlePayphoneInput
) {
  if (input.sessionData.transaction_status !== "Approved") {
    return
  }

  const transactionId = input.payphoneTransactionId
  if (!transactionId) {
    return
  }

  try {
    await deps.client.reverse(transactionId)
  } catch {
    deps.logger?.error?.("PayPhone reverse failed.")
    throw payphoneShopperError("failed")
  }
}

async function reverseApproved(
  deps: SettlePayphoneDeps,
  transaction: PayphoneTransaction,
  sessionId: string
) {
  if (!transaction.transactionId) {
    await deps.claims.markRejected(sessionId)
    return
  }

  try {
    await deps.client.reverse(transaction.transactionId)
  } catch {
    deps.logger?.error?.("PayPhone reverse failed.")
    await deps.claims.markRejected(sessionId)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `${PayphoneResultCode.failed}:No pudimos crear el pedido y el reverso en PayPhone falló. Revierte la transacción en Payphone Business.`
    )
  }

  await deps.claims.markRejected(sessionId)
}
