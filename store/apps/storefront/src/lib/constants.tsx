import { CreditCard } from "@medusajs/icons"
import Bancontact from "@modules/common/icons/bancontact"
import Ideal from "@modules/common/icons/ideal"
import PayPal from "@modules/common/icons/paypal"
import React from "react"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  pp_stripe_stripe: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <Ideal />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <Bancontact />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <PayPal />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <CreditCard />,
  },
  pp_payphone_payphone: {
    title: "PayPhone",
    icon: <CreditCard />,
  },
}

// This only checks if it is native stripe or medusa payments for card payments, it ignores the other stripe-based providers
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") || providerId?.startsWith("pp_medusa-")
  )
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}

export const isPayphone = (providerId?: string) => {
  return providerId?.startsWith("pp_payphone_")
}

/**
 * Manual checkout is a dev affordance. Production builds hide it unless
 * NEXT_PUBLIC_ALLOW_TEST_PAYMENTS=true. The backend enforces the same rule
 * with ALLOW_TEST_PAYMENTS.
 */
export const manualTestPaymentsEnabled = () => {
  if (process.env.NEXT_PUBLIC_ALLOW_TEST_PAYMENTS === "true") {
    return true
  }

  if (process.env.NEXT_PUBLIC_ALLOW_TEST_PAYMENTS === "false") {
    return false
  }

  return process.env.NODE_ENV !== "production"
}

export const payphoneStatusMessage = (code: string | null | undefined) => {
  switch (code) {
    case "cancelled":
      return "Cancelaste el pago en PayPhone. No se creó el pedido."
    case "declined":
      return "PayPhone rechazó el pago. No se creó el pedido. Puedes intentar de nuevo."
    case "mismatch":
      return "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido."
    case "pending":
      return "El pago en PayPhone todavía no está aprobado. No se creó el pedido."
    case "failed":
      return "No pudimos confirmar el pago con PayPhone. No se creó el pedido."
    case "amount":
      return "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido."
    case "currency":
      return "La moneda del pago no es USD. No se creó el pedido."
    case "client":
      return "Esta transacción no corresponde a tu pedido. No se creó el pedido."
    case "cart_changed":
      return "Tu pedido cambió después de iniciar el pago. No se creó el pedido."
    case "in_progress":
      return "Este pago ya se está procesando. Espera un momento y no vuelvas a confirmar."
    default:
      return null
  }
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]
