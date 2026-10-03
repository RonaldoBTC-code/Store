import type { BigNumberInput } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  WorkflowResponse,
  createStep,
  createWorkflow,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"

export type CompletePayphoneCartInput = {
  cart_id: string
  session_id: string
  amount: BigNumberInput
  currency_code: string
  data: Record<string, unknown>
  payphone_transaction_id: number
}

type SessionSnapshot = {
  session_id: string
  amount: BigNumberInput
  currency_code: string
  data: Record<string, unknown>
}

const attachPayphoneTransactionIdStep = createStep(
  "attach-payphone-transaction-id",
  async (input: CompletePayphoneCartInput, { container }) => {
    const payment = container.resolve(Modules.PAYMENT)

    await payment.updatePaymentSession({
      id: input.session_id,
      amount: input.amount,
      currency_code: input.currency_code,
      data: {
        ...input.data,
        session_id: input.session_id,
        payphone_transaction_id: input.payphone_transaction_id,
      },
    })

    const snapshot: SessionSnapshot = {
      session_id: input.session_id,
      amount: input.amount,
      currency_code: input.currency_code,
      data: input.data,
    }

    return new StepResponse(null, snapshot)
  },
  async (snapshot, { container }) => {
    if (!snapshot) {
      return
    }

    const payment = container.resolve(Modules.PAYMENT)
    await payment.updatePaymentSession({
      id: snapshot.session_id,
      amount: snapshot.amount,
      currency_code: snapshot.currency_code,
      data: snapshot.data,
    })
  }
)

/**
 * Stores the PayPhone transaction id on the payment session, then completes
 * the cart. Completing the cart calls authorizePayment, which confirms the
 * charge with PayPhone. Medusa's cart workflow does not create a second order
 * for the same cart.
 */
export const completePayphoneCartWorkflow = createWorkflow(
  "complete-payphone-cart",
  (input: CompletePayphoneCartInput) => {
    attachPayphoneTransactionIdStep(input)

    const order = completeCartWorkflow.runAsStep({
      input: {
        id: input.cart_id,
      },
    })

    return new WorkflowResponse(order)
  }
)
