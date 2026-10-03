import { randomBytes } from "crypto"
import {
  AcquireInput,
  BTCPAY_PROVIDER,
  DEFAULT_INVOICE_TTL_MS,
  invoiceLimitBlocks,
  PaymentRecord,
  PaymentStatus,
} from "./limits"

export type AcquireResult = { ok: true; id: string } | { ok: false }

export type CommitInvoiceInput = {
  id: string
  invoiceId: string
  expiresAt: Date
  reservationIds: string[]
}

export interface BtcpayPaymentStore {
  tryAcquire(input: AcquireInput): Promise<AcquireResult>
  commitInvoice(input: CommitInvoiceInput): Promise<void>
  abort(id: string): Promise<void>
  close(
    invoiceId: string,
    status: Exclude<PaymentStatus, "holding" | "pending">
  ): Promise<string[]>
}

export class MemoryBtcpayPaymentStore implements BtcpayPaymentStore {
  private readonly rows: PaymentRecord[] = []
  private chain: Promise<void> = Promise.resolve()

  async tryAcquire(input: AcquireInput): Promise<AcquireResult> {
    return this.exclusive(async () => {
      if (invoiceLimitBlocks(this.rows, input)) {
        return { ok: false }
      }
      const now = input.now
      const row: PaymentRecord = {
        id: `btpay_${randomBytes(8).toString("hex")}`,
        provider: BTCPAY_PROVIDER,
        status: "holding",
        cartId: input.cartId,
        customerId: input.customerId,
        paymentSessionId: input.paymentSessionId,
        invoiceId: null,
        ipHash: input.ipHash,
        unitCount: input.units,
        createdAt: now,
        expiresAt: new Date(now.getTime() + DEFAULT_INVOICE_TTL_MS),
        reservationIds: [],
      }
      this.rows.push(row)
      return { ok: true, id: row.id }
    })
  }

  async commitInvoice(input: CommitInvoiceInput): Promise<void> {
    const row = this.rows.find((entry) => entry.id === input.id)
    if (!row) {
      return
    }
    row.invoiceId = input.invoiceId
    row.expiresAt = input.expiresAt
    row.reservationIds = input.reservationIds
    row.status = "pending"
  }

  async abort(id: string): Promise<void> {
    const index = this.rows.findIndex((entry) => entry.id === id)
    if (index >= 0 && this.rows[index].status === "holding") {
      this.rows.splice(index, 1)
    }
  }

  async close(
    invoiceId: string,
    status: Exclude<PaymentStatus, "holding" | "pending">
  ): Promise<string[]> {
    const row = this.rows.find((entry) => entry.invoiceId === invoiceId)
    if (!row) {
      return []
    }
    const reservationIds = row.reservationIds
    row.reservationIds = []
    row.status = status
    return reservationIds
  }

  private async exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}
