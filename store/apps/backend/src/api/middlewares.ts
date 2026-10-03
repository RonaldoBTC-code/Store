import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  cartCompletionRejection,
  cartUpdateRejection,
} from "../utils/ec-tax-id"
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

function asAddress(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function assignAddressId(
  holder: Record<string, unknown> | null,
  key: "billing_address" | "shipping_address",
  id: string | undefined
) {
  if (!holder || !id) {
    return
  }

  const address = asAddress(holder[key])
  if (address && typeof address.id !== "string") {
    address.id = id
  }
}

/**
 * The storefront sends the saved billing address id. This still copies a
 * stored billing or shipping id when the request omitted it, onto both the
 * raw body and req.validatedBody, which is what the store route reads.
 * Without an id, Medusa inserts a new cart_address and leaves the previous
 * row, still holding the invoice id, with nothing pointing at it.
 */
async function reuseStoredAddressIds(req: MedusaRequest) {
  const cartId = req.params?.id
  const body = asAddress(req.body)
  const validated = asAddress(
    (req as MedusaRequest & { validatedBody?: unknown }).validatedBody
  )
  if (!cartId || (!body && !validated)) {
    return
  }

  const source = validated ?? body
  const billing = asAddress(source?.billing_address)
  const shipping = asAddress(source?.shipping_address)
  const billingNeedsId = !!billing && typeof billing.id !== "string"
  const shippingNeedsId = !!shipping && typeof shipping.id !== "string"
  if (!billingNeedsId && !shippingNeedsId) {
    return
  }

  try {
    const cartModule = req.scope.resolve(Modules.CART) as {
      retrieveCart(
        id: string,
        config: { relations: string[] }
      ): Promise<{
        billing_address?: { id?: string } | null
        shipping_address?: { id?: string } | null
      }>
    }
    const cart = await cartModule.retrieveCart(cartId, {
      relations: ["billing_address", "shipping_address"],
    })

    if (billingNeedsId) {
      assignAddressId(body, "billing_address", cart.billing_address?.id)
      assignAddressId(validated, "billing_address", cart.billing_address?.id)
    }
    if (shippingNeedsId) {
      assignAddressId(body, "shipping_address", cart.shipping_address?.id)
      assignAddressId(validated, "shipping_address", cart.shipping_address?.id)
    }
  } catch {
    // Medusa reports an unknown cart itself. Skipping the id leaves the
    // update on the path it already had.
  }
}

async function validateTaxIdOnCartUpdate(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const message = cartUpdateRejection(req.body)
  if (message) {
    res.status(400).json({ type: "invalid_data", message })
    return
  }

  await reuseStoredAddressIds(req)
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
      relations: ["billing_address", "shipping_address"],
    })
    const message = cartCompletionRejection(cart)

    if (message) {
      res.status(400).json({ type: "invalid_data", message })
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
