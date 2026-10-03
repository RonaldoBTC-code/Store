import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { planPayphoneCompletion } from "../../../../modules/payphone/completion"
import {
  classifyPayphoneMessage,
  PAYPHONE_SHOPPER_COPY,
} from "../../../../modules/payphone/service"
import { completePayphoneCartWorkflow } from "../../../../workflows/complete-payphone-cart"
import { PostPayphoneCompleteSchema } from "../../../middlewares"

type CompleteBody = {
  id: number | string
  client_transaction_id: string
  cart_id?: string
}

type PaymentSessionRecord = {
  id: string
  amount: number | string
  currency_code: string
  provider_id?: string | null
  data?: Record<string, unknown> | null
  payment_collection_id?: string | null
}

/**
 * Confirms a PayPhone return server-side and completes the cart once.
 * A second call for a cart that already has an order returns that order.
 * A second in-flight confirm loses on the unique claim row.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? req.body) as CompleteBody
  const parsed = PostPayphoneCompleteSchema.safeParse(body)

  if (!parsed.success) {
    declined(res, "failed")
    return
  }

  const payphoneId = Number(parsed.data.id)
  const clientTransactionId = parsed.data.client_transaction_id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sessions } = await query.graph({
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
  const session = (sessions as PaymentSessionRecord[])[0]
  const collectionId = session?.payment_collection_id
  const { data: links } = collectionId
    ? await query.graph({
        entity: "cart_payment_collection",
        fields: ["cart_id", "payment_collection_id"],
        filters: { payment_collection_id: collectionId },
      })
    : { data: [] }
  const cartId = (links as { cart_id?: string }[])[0]?.cart_id ?? null
  const existingOrderId = cartId ? await findOrderId(query, cartId) : null
  const plan = planPayphoneCompletion({
    session,
    cartId,
    existingOrderId,
    payphoneTransactionId: payphoneId,
  })

  if (plan.action === "reject") {
    declined(res, "failed")
    return
  }

  if (plan.action === "return_order") {
    res.status(200).json({
      order_id: plan.orderId,
      country_code: await cartCountry(query, plan.cartId),
    })
    return
  }

  const initiatedAmountCents = plan.data.amount_cents
  if (
    typeof initiatedAmountCents !== "number" ||
    !Number.isSafeInteger(initiatedAmountCents)
  ) {
    declined(res, "failed")
    return
  }

  const { errors, result, transaction } = await completePayphoneCartWorkflow(
    req.scope
  ).run({
    input: {
      cart_id: plan.cartId,
      request_cart_id: parsed.data.cart_id,
      session_id: plan.sessionId,
      amount: plan.amount,
      currency_code: plan.currencyCode,
      data: plan.data,
      payphone_transaction_id: plan.payphoneTransactionId,
      initiated_amount_cents: initiatedAmountCents,
    },
    throwOnError: false,
  })

  if (!transaction.hasFinished()) {
    res.status(409).json({
      code: "failed",
      message: PAYPHONE_SHOPPER_COPY.failed,
    })
    return
  }

  const failure = errors?.[0]?.error as { message?: string } | undefined
  if (failure) {
    const code = classifyPayphoneMessage(failure.message)
    const status = code === "in_progress" ? 409 : 400
    res.status(status).json({
      code,
      message: shopperMessage(code, failure.message),
    })
    return
  }

  const orderId =
    result && typeof result === "object" && "id" in result
      ? String((result as { id?: string }).id ?? "")
      : ""

  if (!orderId) {
    const recovered = await findOrderId(query, plan.cartId)
    if (recovered) {
      res.status(200).json({
        order_id: recovered,
        country_code: await cartCountry(query, plan.cartId),
      })
      return
    }

    declined(res, "failed")
    return
  }

  res.status(200).json({
    order_id: orderId,
    country_code: await cartCountry(query, plan.cartId),
  })
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

function shopperMessage(
  code: keyof typeof PAYPHONE_SHOPPER_COPY,
  raw: string | undefined
) {
  if (raw?.includes("Payphone Business")) {
    return "No pudimos crear el pedido y el reverso en PayPhone falló. Revierte la transacción en Payphone Business."
  }

  return PAYPHONE_SHOPPER_COPY[code]
}

async function findOrderId(
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
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { cart_id: cartId },
  })
  const orderId = (data as { order_id?: string }[])[0]?.order_id

  return orderId || null
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
