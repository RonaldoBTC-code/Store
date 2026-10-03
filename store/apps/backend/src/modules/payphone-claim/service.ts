import { MedusaService } from "@medusajs/framework/utils"
import PayphoneClaim from "./models/payphone-claim"

type PendingClaim = {
  clientTransactionId: string
  cartId: string
  amountCents: number
  currencyCode: string
}

class PayphoneClaimModuleService extends MedusaService({
  PayphoneClaim,
}) {
  async insertPending(input: PendingClaim): Promise<"claimed" | "duplicate"> {
    try {
      await this.createPayphoneClaims({
        client_transaction_id: input.clientTransactionId,
        cart_id: input.cartId,
        amount_cents: input.amountCents,
        currency_code: input.currencyCode,
        status: "pending",
      })
      return "claimed"
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "duplicate"
      }

      throw error
    }
  }

  async markCaptured(
    clientTransactionId: string,
    transactionId: string,
    orderId: string
  ): Promise<void> {
    const [claim] = await this.listPayphoneClaims({
      client_transaction_id: clientTransactionId,
    })

    if (!claim) {
      return
    }

    await this.updatePayphoneClaims({
      id: claim.id,
      transaction_id: transactionId,
      order_id: orderId,
      status: "captured",
    })
  }

  async markRejected(clientTransactionId: string): Promise<void> {
    const [claim] = await this.listPayphoneClaims({
      client_transaction_id: clientTransactionId,
    })

    if (!claim) {
      return
    }

    await this.updatePayphoneClaims({
      id: claim.id,
      status: "rejected",
    })
  }
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < 6 && current; depth++) {
    if (typeof current !== "object") {
      return false
    }

    const record = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }

    if (record.code === "23505") {
      return true
    }

    if (typeof record.message === "string") {
      const text = record.message.toLowerCase()
      if (
        text.includes("unique") ||
        text.includes("duplicate") ||
        text.includes("already exists")
      ) {
        return true
      }
    }

    current = record.cause
  }

  return false
}

export default PayphoneClaimModuleService
