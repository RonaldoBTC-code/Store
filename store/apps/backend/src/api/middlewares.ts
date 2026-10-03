import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { unitCount } from "../modules/btcpay/cart-snapshot"
import { btcpayWebhookGuard } from "../modules/btcpay/webhook-guard"

/**
 * Stamps the BTCPay payment session with the server cart and the connection
 * IP. Client-supplied unit counts and addresses are overwritten.
 */
async function stampBtcpayPaymentContext(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  const body = req.body as {
    provider_id?: string
    data?: Record<string, unknown>
  } | null
  if (!body?.provider_id?.startsWith("pp_btcpay_")) {
    next()
    return
  }

  const data = { ...(body.data ?? {}) }
  data.client_ip = connectionIp(req)

  const cartId = typeof data.cart_id === "string" ? data.cart_id : ""
  if (cartId) {
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: ["id", "customer_id", "items.quantity", "payment_collection.id"],
        filters: { id: cartId },
      })
      const cart = (carts as CartStamp[])[0]
      const collectionId = cart?.payment_collection?.id
      const matchesCollection =
        !collectionId || collectionId === req.params.id
      if (cart && matchesCollection) {
        data.cart_id = cart.id || cartId
        data.unit_count = unitCount(cart.items)
        if (typeof cart.customer_id === "string" && cart.customer_id) {
          data.customer_id = cart.customer_id
        }
      }
    } catch {
      // The payment provider reads the cart again when its snapshot reader is registered.
    }
  }

  body.data = data
  req.body = body
  next()
}

type CartStamp = {
  id?: string
  customer_id?: string | null
  items?: { quantity?: unknown }[] | null
  payment_collection?: { id?: string | null } | null
}

function connectionIp(req: MedusaRequest): string {
  const forwarded = req.ip || req.socket?.remoteAddress || ""
  return forwarded.replace(/^::ffff:/, "")
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/payment-collections/:id/payment-sessions",
      method: "POST",
      middlewares: [stampBtcpayPaymentContext],
    },
    {
      matcher: "/hooks/payment/btcpay_btcpay",
      method: "POST",
      bodyParser: { preserveRawBody: true },
      middlewares: [btcpayWebhookGuard],
    },
    {
      matcher: "/store/btcpay/status",
      method: "GET",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
      ],
    },
  ],
})
