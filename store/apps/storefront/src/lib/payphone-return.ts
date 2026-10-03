export const PAYPHONE_BUTTON_LABEL = "Pagar con PayPhone"
export const PAYPHONE_LEAVING_COPY =
  "Te llevamos a PayPhone para completar el pago"
export const PAYPHONE_CONFIRMING_COPY = "Confirmando tu pago…"
export const PAYPHONE_NO_CHARGE_COPY =
  "No se completó el pago. No se te cobró nada."
export const PAYPHONE_RETRY_LABEL = "Intentar de nuevo"
export const PAYPHONE_PENDING_NOTICE =
  "Estamos confirmando tu pago con PayPhone. Te avisaremos por correo apenas se confirme."

export function showsNoCharge(code: string | null | undefined) {
  return code === "no_charge" || code === "cancelled"
}
