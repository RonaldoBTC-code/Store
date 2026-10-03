import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BtcpayHttpClient } from "../../../../modules/btcpay/client"
import { isBtcpayConfigured } from "../../../../modules/btcpay/constants"
import {
  judgeInvoice,
  paymentBindingCode,
} from "../../../../modules/btcpay/invoice-decision"
import { majorToCents } from "../../../../modules/btcpay/money"
import { getBtcpayPaymentStore } from "../../../../modules/btcpay/payment-registry"
import {
  allowStatusRequest,
  callerOwnsCart,
  hashRateLimitKey,
  publicStatus,
  readStatusQuery,
  STATUS_CLOSED_MESSAGE,
  STATUS_MISMATCH_MESSAGE,
  STATUS_NOT_FOUND,
  STATUS_PAID_LATE_MESSAGE,
  STATUS_PAID_OVER_MESSAGE,
  STATUS_PENDING_MESSAGE,
  STATUS_RATE_LIMITED,
  STATUS_SETTLED_MESSAGE,
} from "../../../../modules/btcpay/status-access"
import { getStockReserver } from "../../../../modules/btcpay/stock"

type SessionRecord = {
  id?: string
  provider_id?: string
  amount?: unknown
  data?: Record<string, unknown> | null
}

type CartRecord = {
  id?: string
  customer_id?: string | null
  total?: unknown
  currency_code?: string | null
  region?: { countries?: { iso_2?: string | null }[] | null } | null
  payment_collection?: { payment_sessions?: SessionRecord[] | null } | null
}

/**
 * Re-fetches the BTCPay invoice for this cart. Browser query params other
 * than the cart id are ignored, including any payment status BTCPay appends.
 */
export async function GET(req: MedusaStoreRequest, res: MedusaResponse) {
  const ip = (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "")
  const lookup = readStatusQuery(req.query as Record<string, unknown>)
  const rateKeys = [`ip:${hashRateLimitKey(ip)}`]
  if (lookup.cartId) {
    rateKeys.push(`cart:${hashRateLimitKey(lookup.cartId)}`)
  }
  if (!allowStatusRequest(rateKeys, Date.now())) {
    res.status(429).json(
      publicStatus({
        state: "limit_reached",
        message: STATUS_RATE_LIMITED,
      })
    )
    return
  }

  if (!isBtcpayConfigured()) {
    res.json(
      publicStatus({
        state: "failed",
        message: "Los pagos con Bitcoin no están habilitados.",
      })
    )
    return
  }

  if (!lookup.cartId || !lookup.paymentSessionId) {
    res.status(404).json(publicStatus({ state: "failed", message: STATUS_NOT_FOUND }))
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "customer_id",
      "total",
      "currency_code",
      "region.countries.iso_2",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: lookup.cartId },
  })

  const cart = (carts as CartRecord[])[0]
  const session = (cart?.payment_collection?.payment_sessions ?? []).find(
    (entry) =>
      entry.id === lookup.paymentSessionId &&
      entry.provider_id?.startsWith("pp_btcpay_")
  )
  const actorId = customerActorId(req)
  if (
    !cart?.id ||
    !callerOwnsCart({
      actorId,
      cartCustomerId:
        typeof cart?.customer_id === "string" && cart.customer_id
          ? cart.customer_id
          : null,
      paymentSessionId: lookup.paymentSessionId,
      cartSessionId: session?.id ?? null,
    })
  ) {
    res.status(404).json(publicStatus({ state: "failed", message: STATUS_NOT_FOUND }))
    return
  }

  const countries = cart.region?.countries ?? []
  if (
    countries.length > 0 &&
    !countries.some((country) => country.iso_2?.toLowerCase() === "ec")
  ) {
    res.json(
      publicStatus({
        state: "failed",
        message: "Bitcoin solo está disponible para Ecuador.",
      })
    )
    return
  }

  if (!session) {
    res.status(404).json(publicStatus({ state: "failed", message: STATUS_NOT_FOUND }))
    return
  }

  const sessionData = session.data ?? {}
  const invoiceId =
    typeof sessionData.invoice_id === "string" ? sessionData.invoice_id : ""
  const sessionCartId =
    typeof sessionData.cart_id === "string" ? sessionData.cart_id : ""
  const sessionCents =
    typeof sessionData.amount_cents === "number" ? sessionData.amount_cents : null

  if (!invoiceId || sessionCartId !== cart.id || sessionCents == null) {
    res.json(
      publicStatus({
        state: "failed",
        message: "Este carrito no tiene un pago con Bitcoin.",
      })
    )
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
    res.json(
      publicStatus({
        state: "cart_changed",
        message:
          "El total del carrito cambió. Vuelve al checkout para generar un nuevo pago.",
      })
    )
    return
  }

  const orderId = await findOrderId(query, cart.id)
  if (orderId) {
    res.json(
      publicStatus({
        state: "settled",
        order_id: orderId,
        message: "Pago confirmado.",
      })
    )
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
  const row = await getBtcpayPaymentStore()?.findByInvoice(invoiceId)
  const binding = paymentBindingCode({
    invoiceStoreId: fetched.storeId,
    expectedStoreId: storeId,
    invoiceCurrency: fetched.currency,
    invoiceAmountCents: invoiceCents,
    invoiceCartId: metadataCart,
    row: row ? { cartId: row.cartId, amountCents: row.amountCents } : null,
  })

  if (binding || (row && row.cartId !== cart.id) || (row && row.amountCents !== sessionCents)) {
    res.json(
      publicStatus({
        state: "mismatch",
        message: STATUS_MISMATCH_MESSAGE,
      })
    )
    return
  }

  const verdict = judgeInvoice(fetched)
  const expiresAt = fetched.expirationTime ?? undefined
  if (verdict.outcome === "authorize") {
    res.json(
      publicStatus({
        state: "settled",
        expires_at: expiresAt,
        message: STATUS_SETTLED_MESSAGE,
      })
    )
    return
  }

  if (verdict.outcome === "pending") {
    res.json(
      publicStatus({
        state: verdict.code,
        expires_at: expiresAt,
        message: STATUS_PENDING_MESSAGE,
      })
    )
    return
  }

  if (verdict.code === "paid_late" || verdict.code === "paid_over") {
    res.json(
      publicStatus({
        state: verdict.code,
        expires_at: expiresAt,
        message:
          verdict.code === "paid_late"
            ? STATUS_PAID_LATE_MESSAGE
            : STATUS_PAID_OVER_MESSAGE,
      })
    )
    return
  }

  if (
    verdict.code === "expired" ||
    verdict.code === "invalid" ||
    verdict.code === "partial"
  ) {
    await releaseHold(fetched.id, fetched.status)
    res.json(
      publicStatus({
        state: verdict.code,
        expires_at: expiresAt,
        message: STATUS_CLOSED_MESSAGE,
      })
    )
    return
  }

  res.json(
    publicStatus({
      state: "failed",
      expires_at: expiresAt,
      message: STATUS_CLOSED_MESSAGE,
    })
  )
}

function customerActorId(req: MedusaStoreRequest): string | null {
  const auth = req.auth_context
  if (!auth || auth.actor_type !== "customer") {
    return null
  }
  return typeof auth.actor_id === "string" && auth.actor_id ? auth.actor_id : null
}

async function releaseHold(invoiceId: string, status: string) {
  const store = getBtcpayPaymentStore()
  if (!store) {
    return
  }
  const closed =
    status === "Expired" ? "expired" : status === "Invalid" ? "invalid" : "canceled"
  try {
    const reservationIds = await store.close(invoiceId, closed)
    await getStockReserver()?.release({ invoiceId, reservationIds })
  } catch {
    return
  }
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
