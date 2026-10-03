import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { headerValue, readRawBody, verifyBtcpaySignature } from "./signature"

/**
 * Runs before the payment webhook route. Medusa keeps `req.rawBody` only when
 * this route sets `preserveRawBody`, and the HMAC is over those bytes.
 * A missing or invalid `BTCPay-Sig` returns 401 and does not call `next`,
 * so the route does not emit an event or write a row.
 */
export function btcpayWebhookGuard(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const secret = process.env.BTCPAY_WEBHOOK_SECRET?.trim() ?? ""
  const raw = readRawBody(req.rawBody)
  const signature = headerValue(
    req.headers as Record<string, unknown> | undefined,
    "btcpay-sig"
  )
  if (raw == null || !verifyBtcpaySignature(raw, signature, secret)) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }
  next()
}
