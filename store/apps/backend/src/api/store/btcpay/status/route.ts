import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BtcpayHttpClient } from "../../../../modules/btcpay/client"
import { isBtcpayConfigured } from "../../../../modules/btcpay/constants"
import { judgeInvoice } from "../../../../modules/btcpay/invoice-decision"
import { majorToCents } from "../../../../modules/btcpay/money"

const PENDING_MESSAGE = "pago pendiente de confirmación"

type SessionRecord = {
  id?: string
  provider_id?: string
  amount?: unknown
  data?: Record<string, unknown> | null
}

type CartRecord = {
  id?: string
  total?: unknown
  currency_code?: string | null
  region?: { countries?: { iso_2?: string | null }[] | null } | null
  payment_collection?: { payment_sessions?: SessionRecord[] | null } | null
}

/**
 * Re-fetches the BTCPay invoice for this cart. Browser query params other
 * than the cart id are ignored, including any payment status BTCPay appends.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isBtcpayConfigured()) {
    res.json({
      state: "failed",
      message: "Los pagos con Bitcoin no están habilitados.",
    })
    return
  }

  const cartId = typeof req.query.cart_id === "string" ? req.query.cart_id : ""
  if (!cartId) {
    res.status(400).json({
      state: "failed",
      message: "Falta el carrito.",
    })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "total",
      "currency_code",
      "region.countries.iso_2",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cartId },
  })

  const cart = (carts as CartRecord[])[0]
  if (!cart) {
    res.json({
      state: "failed",
      message: "No encontramos el carrito.",
    })
    return
  }

  const countries = cart.region?.countries ?? []
  if (
    countries.length > 0 &&
    !countries.some((country) => country.iso_2?.toLowerCase() === "ec")
  ) {
    res.json({
      state: "failed",
      message: "Bitcoin solo está disponible para Ecuador.",
    })
    return
  }

  const session = (cart.payment_collection?.payment_sessions ?? []).find(
    (entry) => entry.provider_id?.startsWith("pp_btcpay_")
  )
  const sessionData = session?.data ?? {}
  const invoiceId =
    typeof sessionData.invoice_id === "string" ? sessionData.invoice_id : ""
  const sessionCartId =
    typeof sessionData.cart_id === "string" ? sessionData.cart_id : ""
  const sessionCents =
    typeof sessionData.amount_cents === "number" ? sessionData.amount_cents : null

  if (!session || !invoiceId || sessionCartId !== cart.id || sessionCents == null) {
    res.json({
      state: "failed",
      message: "Este carrito no tiene un pago con Bitcoin.",
    })
    return
  }

  const cartCents = majorToCents(cart.total)
  const sessionAmountCents = majorToCents(session.amount)
  if (
    cart.currency_code?.toLowerCase() !== "usd" ||
    cartCents == null ||
    sessionAmountCents == null ||
    cartCents !== sessionCents ||
    sessionAmountCents !== sessionCents
  ) {
    res.json({
      state: "cart_changed",
      message:
        "El total del carrito cambió. Vuelve al checkout para generar un nuevo pago.",
    })
    return
  }

  const orderId = await findOrderId(query, cartId)
  if (orderId) {
    res.json({
      state: "settled",
      order_id: orderId,
      message: "Pago confirmado.",
    })
    return
  }

  const url = process.env.BTCPAY_URL?.trim() ?? ""
  const storeId = process.env.BTCPAY_STORE_ID?.trim() ?? ""
  const apiKey = process.env.BTCPAY_API_KEY?.trim() ?? ""
  const client = new BtcpayHttpClient({ url, storeId, apiKey })
  const fetched = await client.getInvoice(invoiceId)
  const invoiceCents = majorToCents(fetched.amount)
  const metadataCart =
    stringValue(fetched.metadata.cartId) || stringValue(fetched.metadata.orderId)

  if (
    fetched.storeId !== storeId ||
    fetched.currency.toUpperCase() !== "USD" ||
    invoiceCents !== sessionCents ||
    metadataCart !== cart.id
  ) {
    res.json({
      state: "mismatch",
      message: "El pago no coincide con este carrito.",
    })
    return
  }

  const verdict = judgeInvoice(fetched)
  if (verdict.outcome === "authorize") {
    res.json({
      state: "settled",
      order_id: null,
      message: "Pago confirmado.",
    })
    return
  }

  if (verdict.outcome === "pending") {
    res.json({
      state: "pending",
      message: PENDING_MESSAGE,
    })
    return
  }

  res.json({
    state: "failed",
    message: "El pago con Bitcoin no se completó. Puedes intentar de nuevo.",
  })
}

async function findOrderId(
  query: {
    graph: (args: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    }) => Promise<{ data: Record<string, unknown>[] }>
  },
  cartId: string
): Promise<string | null> {
  try {
    const { data } = await query.graph({
      entity: "order_cart",
      fields: ["order_id", "cart_id"],
      filters: { cart_id: cartId },
    })
    const orderId = data[0]?.order_id
    return typeof orderId === "string" ? orderId : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}
