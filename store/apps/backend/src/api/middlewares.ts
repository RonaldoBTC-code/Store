import {
  defineMiddlewares,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  SYSTEM_PROVIDER_ID,
  testPaymentsAllowed,
} from "../modules/payphone/providers"

export const PostPayphoneCompleteSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,12}$/)]),
  client_transaction_id: z.string().trim().min(1).max(50),
})

async function blockManualPaymentSession(
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

async function blockManualPaymentCompletion(
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

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/payphone/complete",
      method: "POST",
      middlewares: [validateAndTransformBody(PostPayphoneCompleteSchema)],
    },
    {
      matcher: "/store/payment-collections/:id/payment-sessions",
      method: "POST",
      middlewares: [blockManualPaymentSession],
    },
    {
      matcher: "/store/carts/:id/complete",
      method: "POST",
      middlewares: [blockManualPaymentCompletion],
    },
  ],
})
