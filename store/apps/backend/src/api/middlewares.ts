import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { applyBillingTaxId, normalizeTaxMetadata } from "../utils/ec-tax-id"
import { stripPublicTaxIdentifiers } from "../utils/strip-public-tax-id"

const CART_COMPLETION_REJECTION = {
  type: "invalid_data",
  message: "The cart could not be completed.",
} as const

/**
 * Store cart and order routes are unauthenticated: the cart or order id is the
 * capability. `*billing_address` still loads the metadata column, and
 * `req.disallowed` cannot remove JSON keys inside it. Strip the invoice id
 * from the response body. Admin routes are not matched.
 */
function stripTaxIdFromStoreResponse(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const sendJson = res.json.bind(res)
  res.json = (body) => sendJson(stripPublicTaxIdentifiers(body))
  next()
}

function validateTaxIdOnCartUpdate(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const message = applyBillingTaxId(req.body)
  if (message) {
    res.status(400).json({ type: "invalid_data", message })
    return
  }

  next()
}

async function validateTaxIdOnCartComplete(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const cartService = req.scope.resolve("cart") as {
      retrieveCart: (
        id: string,
        config: { relations: string[] }
      ) => Promise<{ billing_address?: { metadata?: unknown } | null }>
    }
    const cart = await cartService.retrieveCart(req.params.id, {
      relations: ["billing_address"],
    })
    const normalized = normalizeTaxMetadata(cart.billing_address?.metadata)

    if (!normalized.ok) {
      res.status(400).json({ type: "invalid_data", message: normalized.message })
      return
    }

    next()
  } catch {
    res.status(400).json(CART_COMPLETION_REJECTION)
  }
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/carts*",
      middlewares: [stripTaxIdFromStoreResponse],
    },
    {
      matcher: "/store/orders*",
      middlewares: [stripTaxIdFromStoreResponse],
    },
    {
      method: ["POST"],
      matcher: "/store/carts",
      middlewares: [validateTaxIdOnCartUpdate],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id",
      middlewares: [validateTaxIdOnCartUpdate],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/complete",
      middlewares: [validateTaxIdOnCartComplete],
    },
  ],
})
