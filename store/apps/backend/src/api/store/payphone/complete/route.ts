import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYPHONE_PROVIDER_ID } from "../../../../modules/payphone/providers"
import { classifyPayphoneMessage } from "../../../../modules/payphone/service"
import { completePayphoneCartWorkflow } from "../../../../workflows/complete-payphone-cart"
import { PostPayphoneCompleteSchema } from "../../../middlewares"

type CompleteBody = {
  id: number | string
  client_transaction_id: string
}

type PaymentSessionRecord = {
  id: string
  amount: number | string
  currency_code: string
  provider_id?: string | null
  data?: Record<string, unknown> | null
  payment_collection_id?: string | null
}

const SHOPPER_COPY = {
  declined: "PayPhone rechazó el pago. No se creó el pedido.",
  cancelled: "Cancelaste el pago en PayPhone. No se creó el pedido.",
  mismatch:
    "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido.",
  pending: "El pago en PayPhone todavía no está aprobado. No se creó el pedido.",
  failed: "No pudimos confirmar el pago con PayPhone. No se creó el pedido.",
} as const

/**
 * Confirms a PayPhone return server-side and completes the cart once.
 * A second call for a cart that already has an order returns that order.
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

  if (!session || session.provider_id !== PAYPHONE_PROVIDER_ID) {
    declined(res, "failed")
    return
  }

  if (!session.payment_collection_id) {
    declined(res, "failed")
    return
  }

  const { data: links } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { payment_collection_id: session.payment_collection_id },
  })
  const cartId = (links as { cart_id?: string }[])[0]?.cart_id

  if (!cartId) {
    declined(res, "failed")
    return
  }

  const existingOrderId = await findOrderId(query, cartId)
  if (existingOrderId) {
    const countryCode = await cartCountry(query, cartId)
    res.status(200).json({
      order_id: existingOrderId,
      country_code: countryCode,
    })
    return
  }

  const { errors, result, transaction } = await completePayphoneCartWorkflow(
    req.scope
  ).run({
    input: {
      cart_id: cartId,
      session_id: session.id,
      amount: session.amount,
      currency_code: session.currency_code,
      data: session.data ?? {},
      payphone_transaction_id: payphoneId,
    },
    throwOnError: false,
  })

  if (!transaction.hasFinished()) {
    res.status(409).json({
      code: "failed",
      message: SHOPPER_COPY.failed,
    })
    return
  }

  const failure = errors?.[0]?.error as { message?: string } | undefined
  if (failure) {
    const code = classifyPayphoneMessage(failure.message)
    res.status(400).json({
      code,
      message: SHOPPER_COPY[code],
    })
    return
  }

  const orderId =
    result && typeof result === "object" && "id" in result
      ? String((result as { id?: string }).id ?? "")
      : ""

  if (!orderId) {
    const recovered = await findOrderId(query, cartId)
    if (recovered) {
      res.status(200).json({
        order_id: recovered,
        country_code: await cartCountry(query, cartId),
      })
      return
    }

    declined(res, "failed")
    return
  }

  res.status(200).json({
    order_id: orderId,
    country_code: await cartCountry(query, cartId),
  })
}

function declined(
  res: MedusaResponse,
  code: keyof typeof SHOPPER_COPY
) {
  res.status(400).json({
    code,
    message: SHOPPER_COPY[code],
  })
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
