export const PAYPHONE_CLAIM_STATUSES = [
  "pending",
  "processing",
  "captured",
  "rejected",
  "needs_reversal",
  "reversing",
  "reversed",
] as const

export type PayphoneClaimStatus = (typeof PAYPHONE_CLAIM_STATUSES)[number]

/**
 * The only legal moves. Anything else is a no-op, including a caller that
 * still holds an older status in memory.
 */
export const ALLOWED_CLAIM_TRANSITIONS: readonly (readonly [
  PayphoneClaimStatus,
  PayphoneClaimStatus,
])[] = [
  ["pending", "processing"],
  ["processing", "pending"],
  ["processing", "rejected"],
  ["processing", "captured"],
  ["processing", "needs_reversal"],
  ["needs_reversal", "reversing"],
  ["reversing", "captured"],
  ["reversing", "reversed"],
  ["reversing", "needs_reversal"],
]

export function isAllowedClaimTransition(from: string, to: string): boolean {
  return ALLOWED_CLAIM_TRANSITIONS.some(
    ([origin, target]) => origin === from && target === to
  )
}

export type ClaimTransitionPatch = {
  transactionId?: string | null
  clearTransactionId?: boolean
  orderId?: string | null
}

export type ClaimTransitionRow = {
  status: string
  transactionId: string | null
  orderId: string | null
}

/**
 * In-memory form of `UPDATE ... WHERE status = origin`. A forbidden pair or
 * a row that is no longer in `from` returns null and does not mutate.
 */
export function applyClaimTransition<T extends ClaimTransitionRow>(
  row: T,
  from: string,
  to: string,
  patch: ClaimTransitionPatch = {}
): T | null {
  if (!isAllowedClaimTransition(from, to) || row.status !== from) {
    return null
  }

  const next: T = {
    ...row,
    status: to,
    transactionId: patch.clearTransactionId
      ? null
      : patch.transactionId !== undefined
        ? patch.transactionId
        : row.transactionId,
    orderId: patch.orderId !== undefined ? patch.orderId : row.orderId,
  }

  row.status = next.status
  row.transactionId = next.transactionId
  row.orderId = next.orderId
  return next
}
