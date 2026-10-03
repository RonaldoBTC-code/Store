import type { MedusaContainer } from "@medusajs/framework/types"
import { BTCPAY_CLAIM_MODULE } from "../modules/btcpay-claim"
import { redactionLogLine } from "../modules/btcpay/payment-sql"

type Redactor = {
  redactClosedPersonalData(now?: Date): Promise<number>
}

type InfoLogger = {
  info(message: string): void
}

/**
 * Nulls IP and session hashes on closed BTCPay rows older than 30 days.
 * The log line is the row count only.
 */
export default async function btcpayRedactPersonalData(container: MedusaContainer) {
  let service: Redactor
  try {
    service = container.resolve(BTCPAY_CLAIM_MODULE) as Redactor
  } catch {
    return
  }
  const count = await service.redactClosedPersonalData(new Date())
  const logger = container.resolve("logger") as InfoLogger
  logger.info(redactionLogLine(count))
}

export const config = {
  name: "btcpay-redact-personal-data",
  schedule: "0 3 * * *",
}
