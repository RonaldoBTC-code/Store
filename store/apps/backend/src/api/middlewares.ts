import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"

/**
 * Store cart responses omit billing address metadata unless it is allowed.
 * Checkout reads `metadata.tax_id` back from the shopper's own cart.
 * No `method` key: this has to run before query validation.
 */
function allowBillingAddressMetadata(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  req.allowed ??= []
  req.allowed.push("billing_address.metadata")
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/carts/:id",
      middlewares: [allowBillingAddressMetadata],
    },
  ],
})
