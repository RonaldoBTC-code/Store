import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYPHONE_SHOPPER_COPY } from "../../../../modules/payphone/service"
import { PostPayphoneCompleteSchema } from "../../../middlewares"
import { fulfillPayphoneSaleFromScope } from "../../../../workflows/complete-payphone-cart"

type CompleteBody = {
  id: number | string
  client_transaction_id: string
  cart_id?: string
}

/**
 * Confirms a PayPhone return and completes the cart through
 * `completeCartWorkflow`. A cart that already has an order is returned
 * as that order. A second in-flight confirm loses on the unique claim row.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? req.body) as CompleteBody
  const parsed = PostPayphoneCompleteSchema.safeParse(body)

  if (!parsed.success) {
    declined(res, "failed")
    return
  }

  const outcome = await fulfillPayphoneSaleFromScope(req.scope, {
    clientTransactionId: parsed.data.client_transaction_id,
    payphoneTransactionId: Number(parsed.data.id),
    requestCartId: parsed.data.cart_id,
  })

  if (!outcome.ok) {
    const status = outcome.code === "in_progress" ? 409 : 400
    res.status(status).json({
      code: outcome.code,
      message: shopperMessage(outcome.code, outcome.message),
    })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  res.status(200).json({
    order_id: outcome.orderId,
    country_code: await cartCountry(query, outcome.cartId),
  })
}

function shopperMessage(
  code: keyof typeof PAYPHONE_SHOPPER_COPY,
  raw: string | undefined
) {
  if (raw?.includes("Payphone Business")) {
    return "No pudimos crear el pedido y el reverso en PayPhone falló. Revierte la transacción en Payphone Business."
  }

  return PAYPHONE_SHOPPER_COPY[code]
}

function declined(
  res: MedusaResponse,
  code: keyof typeof PAYPHONE_SHOPPER_COPY
) {
  res.status(400).json({
    code,
    message: PAYPHONE_SHOPPER_COPY[code],
  })
}

async function cartCountry(
  query: {
    graph: (args: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    }) => Promise<{ data: unknown }>
  },
  cartId: string
) {
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "shipping_address.country_code"],
    filters: { id: cartId },
  })
  const country = (
    data as { shipping_address?: { country_code?: string | null } }[]
  )[0]?.shipping_address?.country_code

  return (country || "ec").toLowerCase()
}
