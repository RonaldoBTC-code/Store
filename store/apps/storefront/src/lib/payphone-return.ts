export const PAYPHONE_BUTTON_LABEL = "Pagar con PayPhone"
export const PAYPHONE_LEAVING_COPY =
  "Te llevamos a PayPhone para completar el pago"
export const PAYPHONE_CONFIRMING_COPY = "Confirmando tu pago…"
export const PAYPHONE_NO_CHARGE_COPY =
  "No se completó el pago. No se te cobró nada."
export const PAYPHONE_REVERSED_COPY =
  "No se completó el pago. Ya anulamos el cobro en PayPhone."
export const PAYPHONE_RETRY_LABEL = "Intentar de nuevo"
export const PAYPHONE_PENDING_NOTICE =
  "Estamos confirmando tu pago con PayPhone. No vuelvas a pagar. Esta página se actualiza sola en unos minutos."
export const PAYPHONE_CART_CHANGED_COPY = "El total de tu carrito cambió"
export const PAYPHONE_DOCUMENT_COPY = "La cédula o el RUC no es válido."

export function showsNoCharge(code: string | null | undefined) {
  return code === "no_charge" || code === "cancelled"
}
