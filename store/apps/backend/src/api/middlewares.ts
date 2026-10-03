import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { applyBillingTaxId, normalizeTaxMetadata } from "../utils/ec-tax-id"
import { installStoreTaxIdSanitizer } from "../utils/strip-public-tax-id"

const CART_COMPLETION_REJECTION = {
  type: "invalid_data",
  message: "The cart could not be completed.",
} as const

/**
 * Every `/store/*` response is sanitized, including errors and routes that
 * call `res.send` or `res.end` instead of `res.json`. Admin routes are not
 * matched, so order billing metadata stays available for SRI invoicing.
 */
function stripTaxIdFromStoreResponse(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  installStoreTaxIdSanitizer(res)
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
      matcher: /^\/store(?:\/|$)/,
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
