import type {
  BigNumberInput,
  MedusaContainer,
} from "@medusajs/framework/types"
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
import {
  fulfillPayphoneSale,
  type PayphoneFulfillInput,
  type PayphoneFulfillResult,
} from "../modules/payphone/fulfill"
import { PAYPHONE_CLAIM_MODULE } from "../modules/payphone-claim"
import type PayphoneClaimModuleService from "../modules/payphone-claim/service"
import type { PayphoneCompletionSession } from "../modules/payphone/completion"
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
    const settled = await settlePayphonePayment(
      {
        claims,
        client: payphoneClientFromEnv(),
        loadCart: async (cartId) => loadCart(query, cartId),
        complete: (confirmed) =>
          runCompleteCartWorkflow(container, {
            cartId: input.cart_id,
            sessionId: input.session_id,
            amount: input.amount,
            currencyCode: input.currency_code,
            confirmed,
          }),
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
 * Writes the confirmed PayPhone session, then runs Medusa's
 * `completeCartWorkflow`. Checkout validation hooks, including cédula / RUC
 * checks, run inside that workflow. A hook rejection throws out of here so
 * the caller can reverse the PayPhone sale. This function does not create
 * the order itself.
 */
export async function runCompleteCartWorkflow(
  container: { resolve: (key: string) => PaymentSessionUpdater },
  input: {
    cartId: string
    sessionId: string
    amount: BigNumberInput
    currencyCode: string
    confirmed: Record<string, unknown>
  }
): Promise<{ orderId: string }> {
  const payment = container.resolve(Modules.PAYMENT)
  await payment.updatePaymentSession({
    id: input.sessionId,
    amount: input.amount,
    currency_code: input.currencyCode,
    data: input.confirmed,
  })

  const { result } = await completeCartWorkflow(
    container as MedusaContainer
  ).run({
    input: { id: input.cartId },
  })
  const orderId =
    result && typeof result === "object" && "id" in result
      ? String((result as { id?: string }).id ?? "")
      : ""

  return { orderId }
}

type PaymentSessionUpdater = {
  updatePaymentSession: (data: {
    id: string
    amount: BigNumberInput
    currency_code: string
    data: Record<string, unknown>
  }) => Promise<unknown>
}

type QueryGraph = {
  graph: (args: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: unknown }>
}

/**
 * Shopper return and PayPhone notification both enter here. The settle step
 * confirms with PayPhone, then `completeCartWorkflow` creates the order.
 * The claim insert, the HTTP call, and the order insert are separate writes.
 */
export async function fulfillPayphoneSaleFromScope(
  scope: { resolve: (key: string) => unknown },
  input: PayphoneFulfillInput
): Promise<PayphoneFulfillResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const claims = scope.resolve(
    PAYPHONE_CLAIM_MODULE
  ) as PayphoneClaimModuleService

  return fulfillPayphoneSale(
    {
      loadSession: (clientTransactionId) =>
        loadSession(query, clientTransactionId),
      loadCartId: (paymentCollectionId) =>
        loadCartId(query, paymentCollectionId),
      findOrderId: (cartId) => findOrderId(query, cartId),
      findClaim: (clientTransactionId) =>
        claims.getByClientTransactionId(clientTransactionId),
      settle: async (workflowInput) => {
        const { errors, result, transaction } =
          await completePayphoneCartWorkflow(scope as MedusaContainer).run({
            input: workflowInput,
            throwOnError: false,
          })

        if (!transaction.hasFinished()) {
          throw payphoneShopperError("failed")
        }

        const failure = errors?.[0]?.error
        if (failure) {
          throw failure
        }

        const orderId =
          result && typeof result === "object" && "id" in result
            ? String((result as { id?: string }).id ?? "")
            : ""

        return { orderId }
      },
    },
    input
  )
}

/**
 * Inserts the unique PayPhone claim, confirms the sale, then completes the
 * cart through `completeCartWorkflow`. Those are separate writes. This
 * workflow does not wrap the PayPhone HTTP call and the order insert in one
 * database transaction.
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

async function loadSession(
  query: QueryGraph,
  clientTransactionId: string
): Promise<PayphoneCompletionSession | undefined> {
  const { data } = await query.graph({
    entity: "payment_session",
    fields: [
      "id",
      "amount",
      "currency_code",
      "provider_id",
      "data",
      "payment_collection_id",
    ],
    filters: { id: clientTransactionId },
  })

  return (data as PayphoneCompletionSession[])[0]
}

async function loadCartId(query: QueryGraph, paymentCollectionId: string) {
  const { data } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })

  return (data as { cart_id?: string }[])[0]?.cart_id ?? null
}

async function findOrderId(query: QueryGraph, cartId: string) {
  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { cart_id: cartId },
  })

  return (data as { order_id?: string }[])[0]?.order_id || null
}
