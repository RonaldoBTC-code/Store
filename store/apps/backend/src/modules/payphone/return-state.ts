export const PAYPHONE_NO_CHARGE_COPY =
  "No se completó el pago. No se te cobró nada."

export const PAYPHONE_REVERSED_COPY =
  "No se completó el pago. Ya anulamos el cobro en PayPhone."

export const PAYPHONE_PENDING_NOTICE =
  "Estamos confirmando tu pago con PayPhone. No vuelvas a pagar. Esta página se actualiza sola en unos minutos."

export const PAYPHONE_CART_CHANGED_COPY = "El total de tu carrito cambió"

export const PAYPHONE_DOCUMENT_COPY = "La cédula o el RUC no es válido."

export const PAYPHONE_CONFIRMING_COPY = "Confirmando tu pago…"

export type PayphoneChargeState = "none" | "reversal_confirmed" | "open"

export type PayphoneReturnState = "no_charge" | "confirming"

/**
 * The no-charge sentence is only for a sale that never captured, or a
 * reversal PayPhone has already confirmed. An open charge stays on the
 * confirming copy so the shopper is not told the payment failed.
 */
export function shopperReturnState(
  charge: PayphoneChargeState
): PayphoneReturnState {
  if (charge === "none" || charge === "reversal_confirmed") {
    return "no_charge"
  }

  return "confirming"
}

export function shopperReturnMessage(charge: PayphoneChargeState): string {
  if (charge === "reversal_confirmed") {
    return PAYPHONE_REVERSED_COPY
  }

  if (charge === "none") {
    return PAYPHONE_NO_CHARGE_COPY
  }

  return PAYPHONE_PENDING_NOTICE
}

export function shopperOutcomeMessage(
  code: string,
  charge: PayphoneChargeState
): string {
  if (code === "document") {
    return PAYPHONE_DOCUMENT_COPY
  }

  if (code === "cart_changed") {
    return PAYPHONE_CART_CHANGED_COPY
  }

  return shopperReturnMessage(charge)
}
