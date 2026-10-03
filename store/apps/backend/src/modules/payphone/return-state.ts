export const PAYPHONE_NO_CHARGE_COPY =
  "No se completó el pago. No se te cobró nada."

export const PAYPHONE_PENDING_NOTICE =
  "Estamos confirmando tu pago con PayPhone. Te avisaremos por correo apenas se confirme."

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
  return shopperReturnState(charge) === "no_charge"
    ? PAYPHONE_NO_CHARGE_COPY
    : PAYPHONE_PENDING_NOTICE
}
