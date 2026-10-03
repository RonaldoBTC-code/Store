/**
 * Settlement policy. Authorization happens only for Settled + None, or
 * Settled + Marked, and only after the invoice matches the stored payment
 * row. Browser return parameters are never an input.
 *
 * Official values:
 * https://docs.btcpayserver.org/Development/ecommerce-integration-guide/
 * status: New | Processing | Expired | Invalid | Settled
 * additionalStatus: None | PaidLate | PaidPartial | Marked | PaidOver
 *
 * PaidOver and PaidLate are manual review. They never auto-authorize, including
 * when status is Settled. PaidPartial, Expired, and Invalid never authorize.
 * New or Processing with PaidPartial, PaidLate, PaidOver, or Marked never
 * authorize.
 */
export type InvoiceCode =
  | "settled"
  | "pending"
  | "processing"
  | "expired"
  | "invalid"
  | "partial"
  | "paid_late"
  | "paid_over"
  | "unsupported"

export type InvoiceVerdict =
  | { outcome: "authorize"; code: "settled" }
  | { outcome: "pending"; code: "pending" | "processing" }
  | { outcome: "reject"; code: Exclude<InvoiceCode, "settled" | "pending" | "processing"> }

const MANUAL_REVIEW = new Set(["PaidLate", "PaidOver"])

export function judgeInvoice(input: {
  status?: string | null
  additionalStatus?: string | null
}): InvoiceVerdict {
  const status = input.status ?? ""
  const additional = input.additionalStatus || "None"

  if (additional === "PaidPartial") {
    return { outcome: "reject", code: "partial" }
  }
  if (additional === "PaidLate") {
    return { outcome: "reject", code: "paid_late" }
  }
  if (additional === "PaidOver") {
    return { outcome: "reject", code: "paid_over" }
  }
  if (status === "Invalid" || additional === "Invalid") {
    return { outcome: "reject", code: "invalid" }
  }
  if (status === "Expired") {
    return { outcome: "reject", code: "expired" }
  }
  if (
    (status === "New" || status === "Processing" || status === "Expired" || status === "Invalid") &&
    (additional === "Marked" || MANUAL_REVIEW.has(additional))
  ) {
    return { outcome: "reject", code: "unsupported" }
  }

  if (status === "Settled" && (additional === "None" || additional === "Marked")) {
    return { outcome: "authorize", code: "settled" }
  }
  if (status === "Settled") {
    return { outcome: "reject", code: "unsupported" }
  }
  if (status === "Processing") {
    return { outcome: "pending", code: "processing" }
  }
  if (status === "New") {
    return { outcome: "pending", code: "pending" }
  }
  return { outcome: "reject", code: "unsupported" }
}

export type BindingCode =
  | "payment_row_missing"
  | "store_mismatch"
  | "amount_mismatch"
  | "currency_mismatch"
  | "cart_mismatch"

export function paymentBindingCode(input: {
  invoiceStoreId: string
  expectedStoreId: string
  invoiceCurrency: string
  invoiceAmountCents: number | null
  invoiceCartId: string
  row: { cartId: string; amountCents: number } | null
}): BindingCode | null {
  if (!input.row) {
    return "payment_row_missing"
  }
  if (!input.invoiceStoreId || input.invoiceStoreId !== input.expectedStoreId) {
    return "store_mismatch"
  }
  if (input.invoiceCurrency.toUpperCase() !== "USD") {
    return "currency_mismatch"
  }
  if (
    input.invoiceAmountCents == null ||
    input.invoiceAmountCents !== input.row.amountCents
  ) {
    return "amount_mismatch"
  }
  if (!input.invoiceCartId || input.invoiceCartId !== input.row.cartId) {
    return "cart_mismatch"
  }
  return null
}
