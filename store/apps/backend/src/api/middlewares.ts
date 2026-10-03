import {
  defineMiddlewares,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import type { BigNumberInput } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { untaxedMajorFromCart } from "../modules/payphone/amounts"
import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
  testPaymentsAllowed,
} from "../modules/payphone/providers"
import {
  limitPayphoneComplete,
  limitPayphoneNotification,
} from "./payphone-rate-limit"

const PAYPHONE_CLIENT_FIELDS = [
  "payphone_confirmed",
  "transaction_status",
  "transaction_id",
  "authorization_code",
  "status_code",
  "transaction_date",
  "card_brand",
  "last_digits",
] as const

export function payphoneClientSessionData(
  clientData: Record<string, unknown> | undefined,
  cart: { id: string; taxTotal: unknown; untaxedTotal: unknown }
): Record<string, unknown> {
  const data = { ...(clientData ?? {}) }

  for (const field of PAYPHONE_CLIENT_FIELDS) {
    delete data[field]
  }

  return {
    ...data,
    cart_id: cart.id,
    cart_tax_total: cart.taxTotal,
    cart_untaxed_total: cart.untaxedTotal,
  }
}

export const PostPayphoneCompleteSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,12}$/)]),
  client_transaction_id: z.string().trim().min(1).max(50),
  cart_id: z.string().trim().min(1).max(100).optional(),
})

export async function blockManualPaymentSession(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (testPaymentsAllowed()) {
    next()
    return
  }

  const providerId = (req.body as { provider_id?: string } | undefined)?.provider_id

  if (providerId === SYSTEM_PROVIDER_ID) {
    res.status(403).json({
      code: "test_payment_disabled",
      message: "El pago de prueba no está disponible.",
    })
    return
  }

  next()
}

export async function blockManualPaymentCompletion(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (testPaymentsAllowed()) {
    next()
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "payment_collection.payment_sessions.provider_id"],
    filters: { id: req.params.id },
  })
  const sessions =
    (
      data?.[0] as
        | {
            payment_collection?: {
              payment_sessions?: { provider_id?: string | null }[]
            }
          }
        | undefined
    )?.payment_collection?.payment_sessions ?? []

  if (sessions.some((session) => session.provider_id === SYSTEM_PROVIDER_ID)) {
    res.status(403).json({
      code: "test_payment_disabled",
      message: "El pago de prueba no está disponible.",
    })
    return
  }

  next()
}

export async function blockPayphoneCartCompletion(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "payment_collection.payment_sessions.provider_id"],
    filters: { id: req.params.id },
  })
  const sessions =
    (
      data?.[0] as
        | {
            payment_collection?: {
              payment_sessions?: { provider_id?: string | null }[]
            }
          }
        | undefined
    )?.payment_collection?.payment_sessions ?? []

  if (sessions.some((session) => session.provider_id === PAYPHONE_PROVIDER_ID)) {
    res.status(403).json({
      code: "payphone_direct_complete_blocked",
      message: "El pago con PayPhone se confirma al volver de PayPhone.",
    })
    return
  }

  next()
}

async function attachPayphoneCartTotals(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const body = req.body as
    | { provider_id?: string; data?: Record<string, unknown> }
    | undefined

  if (body?.provider_id !== PAYPHONE_PROVIDER_ID) {
    next()
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const collectionId = req.params.id
  const { data: links } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { payment_collection_id: collectionId },
  })
  const cartId = (links as { cart_id?: string }[])[0]?.cart_id

  if (!cartId) {
    res.status(400).json({
      message: "No pudimos iniciar el pago con PayPhone.",
    })
    return
  }

  const { data: carts } = await query.graph({
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
  const cart = (
    carts as {
      id?: string
      currency_code?: string
      total?: unknown
      tax_total?: unknown
      shipping_total?: unknown
      shipping_tax_total?: unknown
    }[]
  )[0]

  if (!cart?.id || String(cart.currency_code ?? "").toLowerCase() !== "usd") {
    res.status(400).json({
      message: "PayPhone solo está habilitado para USD.",
    })
    return
  }

  if (cart.tax_total == null || cart.total == null) {
    res.status(400).json({
      message: "No pudimos calcular el IVA del pedido.",
    })
    return
  }

  let untaxedTotal: BigNumberInput = 0

  try {
    untaxedTotal = untaxedMajorFromCart({
      shipping_total: (cart.shipping_total ?? 0) as BigNumberInput,
      shipping_tax_total: (cart.shipping_tax_total ?? 0) as BigNumberInput,
    })
  } catch {
    res.status(400).json({
      message: "No pudimos calcular el IVA del pedido.",
    })
    return
  }

  req.body = {
    ...body,
    data: payphoneClientSessionData(body.data, {
      id: cart.id,
      taxTotal: cart.tax_total,
      untaxedTotal,
    }),
  }
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/payphone/notificacion",
      method: "POST",
      middlewares: [limitPayphoneNotification],
    },
    {
      matcher: "/store/payphone/complete",
      method: "POST",
      middlewares: [
        limitPayphoneComplete,
        validateAndTransformBody(PostPayphoneCompleteSchema),
      ],
    },
    {
      matcher: "/store/payment-collections/:id/payment-sessions",
      method: "POST",
      middlewares: [blockManualPaymentSession, attachPayphoneCartTotals],
    },
    {
      matcher: "/store/carts/:id/complete",
      method: "POST",
      middlewares: [blockManualPaymentCompletion, blockPayphoneCartCompletion],
    },
  ],
})
