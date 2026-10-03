import { MedusaError } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  cartCompletionRejection,
  cartUpdateRejection,
} from "../../utils/ec-tax-id"

function reject(message: string | null) {
  if (message) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
}

// Runs before updateCartsStep, including updates that never hit the store route.
updateCartWorkflow.hooks.validate(async ({ input }) => {
  reject(cartUpdateRejection(input))
})

// Runs for /complete and for a payment webhook that completes the cart directly.
// The cart argument is the snapshot already loaded for the order.
completeCartWorkflow.hooks.validate(async ({ cart }) => {
  reject(cartCompletionRejection(cart))
})
