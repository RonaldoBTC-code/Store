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

export type PayphoneReturnSnapshot = {
  state?: string
  code?: string
  charge?: string
  message?: string
}

export type PayphoneReturnView = "confirming" | "pending" | "reversed" | "rejected"

const CONFIRMING_MS = 30_000

/**
 * Network and timeout leave the claim in `processing`. Moving it back to
 * `pending`, including when Confirm names someone else's id, is the same
 * shopper outcome: the long confirming notice, with no retry.
 */
export function keepsShopperConfirming(
  result: PayphoneReturnSnapshot | null
): boolean {
  if (!result || result.charge !== "open") {
    return false
  }

  return result.code === "pending" || result.code === "failed"
}

export function payphoneReturnView(
  result: PayphoneReturnSnapshot | null,
  elapsedMs: number
): PayphoneReturnView {
  if (result?.charge === "reversal_confirmed") {
    return "reversed"
  }

  if (keepsShopperConfirming(result)) {
    return "pending"
  }

  if (result?.charge === "none" || result?.state === "no_charge") {
    return "rejected"
  }

  if (elapsedMs >= CONFIRMING_MS) {
    return "pending"
  }

  return "confirming"
}
