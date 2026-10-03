import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readPayphoneNotification } from "../../../../modules/payphone/notification"
import { fulfillPayphoneSaleFromScope } from "../../../../workflows/complete-payphone-cart"

/**
 * PayPhone Notificación externa. There is no documented signature, so this
 * route does not trust the posted amount. It confirms through the same
 * completion path as the shopper return, which calls `completeCartWorkflow`.
 * A notification with no return visit still creates one order. A second
 * notification, or a notification racing the return, hits the unique claim
 * row or the existing order and does not create another.
 * https://docs.payphone.app/notificacion-externa
 *
 * The built-in `/hooks/payment/:provider` route answers with an empty 200,
 * which is not the body PayPhone asks for. Point the dashboard webhook here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = readPayphoneNotification(
    req.body,
    process.env.PAYPHONE_STORE_ID
  )

  if (parsed.action === "ack") {
    res.status(200).json({ Response: false, ErrorCode: parsed.errorCode })
    return
  }

  try {
    const outcome = await fulfillPayphoneSaleFromScope(req.scope, {
      clientTransactionId: parsed.clientTransactionId,
      payphoneTransactionId: parsed.transactionId,
    })

    if (outcome.ok || outcome.alreadySettled) {
      res.status(200).json({ Response: true, ErrorCode: "000" })
      return
    }

    res.status(200).json({ Response: false, ErrorCode: "222" })
  } catch {
    res.status(200).json({ Response: false, ErrorCode: "222" })
  }
}
