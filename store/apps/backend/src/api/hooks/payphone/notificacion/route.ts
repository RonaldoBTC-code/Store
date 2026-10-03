import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { processPaymentWorkflowId } from "@medusajs/medusa/core-flows"
import { Modules, PaymentActions } from "@medusajs/framework/utils"

/**
 * PayPhone Notificación externa. The product requires a prior commercial
 * authorization and a JSON ack (`Response` / `ErrorCode`). It does not
 * document a signature, so this route re-confirms the transaction with
 * PayPhone before Medusa is allowed to complete a cart.
 * https://docs.payphone.app/notificacion-externa
 *
 * The built-in `/hooks/payment/:provider` route answers with an empty 200,
 * which is not the body PayPhone asks for. Point the dashboard webhook here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body =
    req.body && typeof req.body === "object" ? req.body : undefined

  if (!body) {
    res.status(200).json({ Response: false, ErrorCode: "222" })
    return
  }

  try {
    const payment = req.scope.resolve(Modules.PAYMENT)
    const action = await payment.getWebhookActionAndData({
      provider: "payphone_payphone",
      payload: {
        data: body as Record<string, unknown>,
        rawData:
          typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)
            ? req.rawBody
            : JSON.stringify(body),
        headers: req.headers as Record<string, unknown>,
      },
    })

    if (
      action.action !== PaymentActions.SUCCESSFUL &&
      action.action !== PaymentActions.AUTHORIZED
    ) {
      const storeMismatch = action.action === PaymentActions.NOT_SUPPORTED
      res.status(200).json({
        Response: false,
        ErrorCode: storeMismatch ? "666" : "222",
      })
      return
    }

    if (!action.data?.session_id) {
      res.status(200).json({ Response: false, ErrorCode: "444" })
      return
    }

    const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
    const { errors } = await workflowEngine.run(processPaymentWorkflowId, {
      input: action,
      throwOnError: false,
    })

    if (errors?.length) {
      res.status(200).json({ Response: false, ErrorCode: "222" })
      return
    }

    res.status(200).json({ Response: true, ErrorCode: "000" })
  } catch {
    res.status(200).json({ Response: false, ErrorCode: "222" })
  }
}
