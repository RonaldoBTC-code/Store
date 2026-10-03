/**
 * Settlement policy. Authorization happens only when BTCPay's invoice
 * `status` is `Settled` and `additionalStatus` is not a partial or invalid
 * payment. Browser return parameters are never an input to this decision.
 *
 * Official status values:
 * https://docs.btcpayserver.org/Development/ecommerce-integration-guide/
 * status: New | Processing | Expired | Invalid | Settled
 * additionalStatus: None | PaidLate | PaidPartial | Marked | PaidOver
 *
 * - Settled + None: confirmed payment for the invoice amount. Authorize.
 * - Settled + PaidOver: the invoice USD amount was paid and extra crypto
 *   arrived. The order total is still the invoice amount. Authorize.
 * - Settled + PaidLate: BTCPay settled a payment that arrived after expiry.
 *   Authorize. Expired without Settled is not enough.
 * - Settled + Marked: a store admin marked the invoice settled in BTCPay.
 *   Authorize, because the server-side status is Settled.
 * - PaidPartial (any status): underpaid. Never authorize.
 * - Processing or New: payment is unseen or still unconfirmed. Do not
 *   authorize. The storefront keeps showing "pago pendiente de confirmación".
 * - Expired or Invalid: do not authorize. Webhooks for these states must not
 *   complete the cart.
 */
export type InvoiceVerdict =
  | { outcome: "authorize" }
  | { outcome: "pending"; reason: string }
  | { outcome: "reject"; reason: string }

export function judgeInvoice(input: {
  status?: string | null
  additionalStatus?: string | null
}): InvoiceVerdict {
  const status = input.status ?? ""
  const additional = input.additionalStatus || "None"

  if (additional === "PaidPartial") {
    return {
      outcome: "reject",
      reason:
        "Invoice is underpaid (additionalStatus PaidPartial). Payment is not authorized.",
    }
  }

  if (status === "Invalid" || additional === "Invalid") {
    return {
      outcome: "reject",
      reason: "Invoice is invalid. Payment is not authorized.",
    }
  }

  if (status === "Expired") {
    return {
      outcome: "reject",
      reason:
        "Invoice is expired. Payment is not authorized until BTCPay reports status Settled.",
    }
  }

  if (status === "Settled") {
    if (
      additional === "None" ||
      additional === "PaidOver" ||
      additional === "PaidLate" ||
      additional === "Marked"
    ) {
      return { outcome: "authorize" }
    }
    return {
      outcome: "reject",
      reason: `Invoice is Settled with unsupported additionalStatus ${additional}.`,
    }
  }

  if (status === "Processing") {
    return {
      outcome: "pending",
      reason:
        "Payment was seen but is not confirmed. Waiting for BTCPay status Settled.",
    }
  }

  if (status === "New") {
    return {
      outcome: "pending",
      reason: "Invoice is unpaid. Waiting for BTCPay status Settled.",
    }
  }

  return {
    outcome: "reject",
    reason: `Unsupported BTCPay invoice status "${status || "unknown"}".`,
  }
}
