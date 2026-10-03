import { MedusaError } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"
import {
  splitFromCartTotals,
  untaxedMajorFromCart,
} from "./amounts"
import type { PayphoneHttpClient, PayphoneTransaction } from "./client"
import type { PayphoneClaimRecord } from "../payphone-claim/service"
import type { PayphoneChargeState } from "./return-state"
import {
  buildConfirmedSessionData,
  classifyTransaction,
  isServerConfirmed,
  payphoneShopperError,
  type PayphoneShopperCode,
} from "./service"

const COMPLETE_TIMEOUT_MS = 25_000
const REVERSE_TIMEOUT_MS = 10_000

/**
 * Confirms a PayPhone return and then completes the cart.
 *
 * Webhook and shopper return both call this. The pending claim row is moved
 * to `processing` with one UPDATE ... WHERE status = 'pending' RETURNING *.
 * Only that caller creates the order. The claim insert, the PayPhone HTTP
 * call, and the order insert are still separate writes.
 *
 * After an approved Confirm, a failed or timed-out order is marked
 * `needs_reversal` in one database transaction before Reverse is attempted.
 * A reverse timeout leaves that row for the scheduled job.
 */
export type PayphoneClaimStore = {
  ensurePending(input: {
    clientTransactionId: string
    cartId: string
    amountCents: number
    currencyCode: string
  }): Promise<PayphoneClaimRecord>
  claimProcessing(id: string): Promise<PayphoneClaimRecord | null>
  attachTransactionId(
    id: string,
    transactionId: string
  ): Promise<"attached" | "duplicate">
  markNeedsReversal(id: string, transactionId: string): Promise<void>
  markReversed(id: string): Promise<void>
  markRejected(id: string): Promise<void>
  markCaptured(
    clientTransactionId: string,
    transactionId: string,
    orderId: string
  ): Promise<void>
  getByTransactionId(transactionId: string): Promise<PayphoneClaimRecord | null>
  getByClientTransactionId(
    clientTransactionId: string
  ): Promise<PayphoneClaimRecord | null>
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
  completeTimeoutMs?: number
  reverseTimeoutMs?: number
}

export async function settlePayphonePayment(
  deps: SettlePayphoneDeps,
  input: SettlePayphoneInput
): Promise<{ orderId: string; transactionId: number }> {
  if (input.requestCartId && input.requestCartId !== input.sessionCartId) {
    fail("client", "none")
  }

  const cart = await deps.loadCart(input.sessionCartId)
  if (!cart || cart.id !== input.sessionCartId) {
    fail("client", "none")
  }

  if (
    input.currencyCode.toLowerCase() !== "usd" ||
    cart.currencyCode.toLowerCase() !== "usd"
  ) {
    fail("currency", "none")
  }

  const owned = await deps.claims.getByTransactionId(
    String(input.payphoneTransactionId)
  )
  if (owned && owned.clientTransactionId !== input.sessionId) {
    fail("client", "none")
  }

  const split = splitFromCartTotals({
    total: cart.total,
    taxTotal: cart.taxTotal,
    untaxedTotal: untaxedMajorFromCart({
      shipping_total: cart.shippingTotal,
      shipping_tax_total: cart.shippingTaxTotal,
    }),
  })

  const pending = await deps.claims.ensurePending({
    clientTransactionId: input.sessionId,
    cartId: input.sessionCartId,
    amountCents: split.amount,
    currencyCode: "usd",
  })

  const claimed = await deps.claims.claimProcessing(pending.id)
  if (!claimed) {
    const current = await deps.claims.getByClientTransactionId(input.sessionId)
    fail("in_progress", chargeForStatus(current?.status ?? pending.status))
  }

  if (split.amount !== input.initiatedAmountCents) {
    const charge = await reverseApprovedCharge(
      deps,
      claimed.id,
      input.payphoneTransactionId
    )
    fail("cart_changed", charge)
  }

  let transaction: PayphoneTransaction

  try {
    transaction = await confirmedTransaction(deps, input, split.amount)
  } catch (error) {
    await deps.claims.markRejected(claimed.id)
    if (error instanceof MedusaError) {
      fail("failed", "none")
    }

    fail("failed", "none")
  }

  const outcome = classifyTransaction(transaction)
  if (outcome !== "approved") {
    await deps.claims.markRejected(claimed.id)
    fail(outcomeCode(outcome), "none")
  }

  const mismatch = confirmedMismatch(transaction, input.sessionId, split.amount)
  if (mismatch) {
    const charge = await reverseApprovedCharge(
      deps,
      claimed.id,
      transaction.transactionId ?? input.payphoneTransactionId
    )
    fail(mismatch, charge)
  }

  const transactionId = transaction.transactionId ?? input.payphoneTransactionId
  const attached = await deps.claims.attachTransactionId(
    claimed.id,
    String(transactionId)
  )
  if (attached === "duplicate") {
    await deps.claims.markRejected(claimed.id)
    fail("client", "none")
  }

  const confirmed = buildConfirmedSessionData(
    input.sessionData,
    transaction,
    input.sessionId,
    split.amount
  )

  let orderId = ""

  try {
    const completed = await withTimeout(
      deps.complete(confirmed),
      deps.completeTimeoutMs ?? COMPLETE_TIMEOUT_MS
    )
    orderId = completed.orderId
  } catch (error) {
    await deps.claims.markNeedsReversal(claimed.id, String(transactionId))
    deps.logger?.error?.("PayPhone order was not created after confirm.")

    if (isTimeout(error)) {
      fail("failed", "open")
    }

    const charge = await tryReverse(deps, transactionId)
    if (charge === "reversal_confirmed") {
      await deps.claims.markReversed(claimed.id)
    }
    fail("failed", charge)
  }

  if (!orderId) {
    await deps.claims.markNeedsReversal(claimed.id, String(transactionId))
    const charge = await tryReverse(deps, transactionId)
    if (charge === "reversal_confirmed") {
      await deps.claims.markReversed(claimed.id)
    }
    fail("failed", charge)
  }

  try {
    await deps.claims.markCaptured(
      input.sessionId,
      String(transactionId),
      orderId
    )
  } catch {
    deps.logger?.error?.(
      "PayPhone claim stayed pending after the order was created."
    )
  }

  return {
    orderId,
    transactionId,
  }
}

async function reverseApprovedCharge(
  deps: SettlePayphoneDeps,
  claimId: string,
  transactionId: number
): Promise<PayphoneChargeState> {
  await deps.claims.markNeedsReversal(claimId, String(transactionId))
  const charge = await tryReverse(deps, transactionId)
  if (charge === "reversal_confirmed") {
    await deps.claims.markReversed(claimId)
  }

  return charge
}

async function tryReverse(
  deps: SettlePayphoneDeps,
  transactionId: number
): Promise<PayphoneChargeState> {
  try {
    await withTimeout(
      deps.client.reverse(transactionId),
      deps.reverseTimeoutMs ?? REVERSE_TIMEOUT_MS
    )
    return "reversal_confirmed"
  } catch {
    deps.logger?.error?.("PayPhone reverse failed.")
    return "open"
  }
}

function isTimeout(error: unknown) {
  return error instanceof MedusaError && error.message === "PAYPHONE_TIMEOUT"
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "PAYPHONE_TIMEOUT")
      )
    }, ms)

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
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

function fail(code: PayphoneShopperCode, charge: PayphoneChargeState): never {
  const error = payphoneShopperError(code) as MedusaError & {
    charge?: PayphoneChargeState
  }
  error.charge = charge
  throw error
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
