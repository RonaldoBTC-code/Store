import type { BigNumberInput } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  WorkflowResponse,
  createStep,
  createWorkflow,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { PayphoneClient } from "../modules/payphone/client"
import { PAYPHONE_CLAIM_MODULE } from "../modules/payphone-claim"
import type PayphoneClaimModuleService from "../modules/payphone-claim/service"
import {
  settlePayphonePayment,
  type PayphoneCartSnapshot,
} from "../modules/payphone/settle"
import { payphoneShopperError } from "../modules/payphone/service"

export type CompletePayphoneCartInput = {
  cart_id: string
  request_cart_id?: string | null
  session_id: string
  amount: BigNumberInput
  currency_code: string
  data: Record<string, unknown>
  payphone_transaction_id: number
  initiated_amount_cents: number
}

type CartRow = {
  id?: string
  currency_code?: string
  total?: BigNumberInput
  tax_total?: BigNumberInput
  shipping_total?: BigNumberInput | null
  shipping_tax_total?: BigNumberInput | null
}

const settlePayphoneCartStep = createStep(
  "settle-payphone-cart",
  async (input: CompletePayphoneCartInput, { container }) => {
    const claims = container.resolve(
      PAYPHONE_CLAIM_MODULE
    ) as PayphoneClaimModuleService
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const payment = container.resolve(Modules.PAYMENT)
    const settled = await settlePayphonePayment(
      {
        claims,
        client: payphoneClientFromEnv(),
        loadCart: async (cartId) => loadCart(query, cartId),
        complete: async (confirmed) => {
          await payment.updatePaymentSession({
            id: input.session_id,
            amount: input.amount,
            currency_code: input.currency_code,
            data: confirmed,
          })

          const { result } = await completeCartWorkflow(container).run({
            input: { id: input.cart_id },
          })
          const orderId =
            result && typeof result === "object" && "id" in result
              ? String((result as { id?: string }).id ?? "")
              : ""

          return { orderId }
        },
      },
      {
        sessionCartId: input.cart_id,
        requestCartId: input.request_cart_id,
        sessionId: input.session_id,
        currencyCode: input.currency_code,
        initiatedAmountCents: input.initiated_amount_cents,
        payphoneTransactionId: input.payphone_transaction_id,
        sessionData: input.data,
      }
    )

    return new StepResponse({ id: settled.orderId })
  }
)

/**
 * Inserts the unique PayPhone claim, confirms the sale, then completes the
 * cart. Those are separate writes. This workflow does not wrap the PayPhone
 * HTTP call and the order insert in one database transaction.
 */
export const completePayphoneCartWorkflow = createWorkflow(
  "complete-payphone-cart",
  (input: CompletePayphoneCartInput) => {
    const order = settlePayphoneCartStep(input)

    return new WorkflowResponse(order)
  }
)

function payphoneClientFromEnv() {
  const token = process.env.PAYPHONE_TOKEN
  const storeId = process.env.PAYPHONE_STORE_ID
  const responseUrl = process.env.PAYPHONE_RESPONSE_URL
  const cancellationUrl = process.env.PAYPHONE_CANCELLATION_URL

  if (!token || !storeId || !responseUrl || !cancellationUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      payphoneShopperError("failed").message
    )
  }

  return new PayphoneClient({
    token,
    storeId,
    responseUrl,
    cancellationUrl,
  })
}

async function loadCart(
  query: {
    graph: (args: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    }) => Promise<{ data: unknown }>
  },
  cartId: string
): Promise<PayphoneCartSnapshot | null> {
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "total",
      "tax_total",
      "shipping_total",
      "shipping_tax_total",
    ],
    filters: { id: cartId },
  })
  const cart = (data as CartRow[])[0]

  if (!cart?.id || cart.total == null || cart.tax_total == null) {
    return null
  }

  return {
    id: cart.id,
    currencyCode: cart.currency_code ?? "",
    total: cart.total,
    taxTotal: cart.tax_total,
    shippingTotal: cart.shipping_total,
    shippingTaxTotal: cart.shipping_tax_total,
  }
}
