import { MedusaService } from "@medusajs/framework/utils"
import {
  claimOnce,
  isUniqueViolation,
  type BtcpayClaimStore,
  type ClaimInput,
} from "../btcpay/claim"
import { registerBtcpayClaimStore } from "../btcpay/claim-registry"
import {
  AcquireInput,
  BTCPAY_PROVIDER,
  DEFAULT_INVOICE_TTL_MS,
  invoiceLimitBlocks,
  PaymentRecord,
  PaymentStatus,
} from "../btcpay/limits"
import { registerBtcpayPaymentStore } from "../btcpay/payment-registry"
import {
  abortHoldingPayment,
  acquirePaymentSlot,
  closeOpenPayment,
  commitOpenInvoice,
  confirmSettlement,
  DbManager,
  mikroTx,
  newClaimId,
  redactClosedPersonalData,
} from "../btcpay/payment-sql"
import {
  BtcpayPaymentStore,
  CommitInvoiceInput,
  StoredInvoicePayment,
} from "../btcpay/payment-store"
import BtcpayInvoiceClaim from "./models/invoice-claim"
import BtcpayPayment from "./models/payment"

type PaymentRow = {
  id: string
  provider?: string | null
  status?: string | null
  cart_id?: string | null
  customer_id?: string | null
  payment_session_hash?: string | null
  invoice_id?: string | null
  ip_hash?: string | null
  unit_count?: number | null
  amount_cents?: number | string | null
  created_at?: Date | string | null
  expires_at?: Date | string | null
  reservation_ids?: unknown
}

class BtcpayClaimModuleService
  extends MedusaService({ BtcpayInvoiceClaim, BtcpayPayment })
  implements BtcpayClaimStore, BtcpayPaymentStore
{
  private chain: Promise<void> = Promise.resolve()
  private readonly db_?: DbManager

  constructor(container: { manager?: DbManager } & Record<string, unknown>) {
    // MedusaService's generated constructor is not part of the public types.
    super(container as never)
    this.db_ = container.manager
    registerBtcpayClaimStore(this)
    registerBtcpayPaymentStore(this)
  }

  async claim(input: ClaimInput) {
    return claimOnce(async () => {
      const manager = this.db_
      if (manager?.transactional) {
        await manager.transactional(async (tx) => {
          await confirmSettlement(mikroTx(tx), {
            id: newClaimId(),
            invoiceId: input.invoiceId,
            cartId: input.cartId,
            paymentSessionHash: input.paymentSessionId,
            amountCents: input.amountCents,
            currencyCode: input.currencyCode,
          })
        })
        return
      }
      await this.createBtcpayInvoiceClaims({
        invoice_id: input.invoiceId,
        cart_id: input.cartId,
        payment_session_hash: input.paymentSessionId,
        amount_cents: input.amountCents,
        currency_code: input.currencyCode,
      })
    })
  }

  async tryAcquire(input: AcquireInput) {
    const manager = this.db_
    if (manager?.transactional) {
      return manager.transactional(async (tx) => acquirePaymentSlot(mikroTx(tx), input))
    }
    return this.exclusive(async () => {
      const rows = await this.rowsFor(input)
      if (invoiceLimitBlocks(rows, input)) {
        return { ok: false as const }
      }
      try {
        const created = await this.createBtcpayPayments({
          provider: BTCPAY_PROVIDER,
          status: "holding",
          cart_id: input.cartId,
          customer_id: input.customerId,
          payment_session_hash: input.paymentSessionId,
          invoice_id: null,
          ip_hash: input.ipHash,
          unit_count: input.units,
          amount_cents: input.amountCents,
          expires_at: new Date(input.now.getTime() + DEFAULT_INVOICE_TTL_MS),
          reservation_ids: { ids: [] },
          replaces_id: null,
        })
        const id = created.id
        if (!id) {
          return { ok: false as const }
        }
        return { ok: true as const, id }
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false as const }
        }
        throw error
      }
    })
  }

  async redactClosedPersonalData(now: Date = new Date()): Promise<number> {
    const manager = this.db_
    if (!manager?.transactional) {
      return 0
    }
    return manager.transactional(async (tx) => redactClosedPersonalData(mikroTx(tx), now))
  }

  async commitInvoice(input: CommitInvoiceInput): Promise<boolean> {
    const manager = this.db_
    if (manager?.transactional) {
      return manager.transactional(async (tx) => commitOpenInvoice(mikroTx(tx), input))
    }
    const rows = await this.listBtcpayPayments({ id: input.id })
    const row = rows[0]
    if (row?.status !== "holding") {
      return false
    }
    await this.updateBtcpayPayments({
      id: input.id,
      invoice_id: input.invoiceId,
      expires_at: input.expiresAt,
      reservation_ids: { ids: input.reservationIds },
      status: "pending",
    })
    return true
  }

  async abort(id: string) {
    const manager = this.db_
    if (manager?.transactional) {
      await manager.transactional(async (tx) => abortHoldingPayment(mikroTx(tx), id))
      return
    }
    const rows = await this.listBtcpayPayments({ id })
    const row = rows[0]
    if (row?.status === "holding") {
      await this.deleteBtcpayPayments(id)
    }
  }

  async findByInvoice(invoiceId: string): Promise<StoredInvoicePayment | null> {
    if (!invoiceId) {
      return null
    }
    const rows = await this.listBtcpayPayments({
      provider: BTCPAY_PROVIDER,
      invoice_id: invoiceId,
    })
    const row = rows[0]
    if (!row) {
      return null
    }
    const amount = row.amount_cents
    const amountCents =
      typeof amount === "number"
        ? amount
        : typeof amount === "string" && /^-?\d+$/.test(amount)
          ? Number(amount)
          : 0
    return {
      cartId: row.cart_id || "",
      amountCents,
      paymentSessionHash: row.payment_session_hash || "",
    }
  }

  async close(
    invoiceId: string,
    status: Exclude<PaymentStatus, "holding" | "pending">
  ) {
    const manager = this.db_
    if (manager?.transactional) {
      return manager.transactional(async (tx) =>
        closeOpenPayment(mikroTx(tx), invoiceId, status)
      )
    }
    const rows = await this.listBtcpayPayments({
      provider: BTCPAY_PROVIDER,
      invoice_id: invoiceId,
    })
    const row = rows.find(
      (entry) => entry.status === "holding" || entry.status === "pending"
    )
    if (!row) {
      return []
    }
    const reservationIds = readReservationIds(row.reservation_ids)
    await this.updateBtcpayPayments({
      id: row.id,
      status,
      reservation_ids: { ids: [] },
    })
    return reservationIds
  }

  private async rowsFor(input: AcquireInput): Promise<PaymentRecord[]> {
    const lists = [
      this.listBtcpayPayments({
        provider: BTCPAY_PROVIDER,
        cart_id: input.cartId,
      }),
      this.listBtcpayPayments({
        provider: BTCPAY_PROVIDER,
        payment_session_hash: input.paymentSessionId,
      }),
    ]
    if (input.customerId) {
      lists.push(
        this.listBtcpayPayments({
          provider: BTCPAY_PROVIDER,
          customer_id: input.customerId,
        })
      )
    }
    if (input.ipHash) {
      lists.push(
        this.listBtcpayPayments({
          provider: BTCPAY_PROVIDER,
          ip_hash: input.ipHash,
        })
      )
    }
    const groups = await Promise.all(lists)
    const byId = new Map<string, PaymentRecord>()
    for (const group of groups) {
      for (const row of group) {
        byId.set(row.id, mapPayment(row))
      }
    }
    return [...byId.values()]
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    provider: row.provider || BTCPAY_PROVIDER,
    status: (row.status || "pending") as PaymentStatus,
    cartId: row.cart_id || "",
    customerId: row.customer_id ?? null,
    paymentSessionId: row.payment_session_hash || "",
    invoiceId: row.invoice_id ?? null,
    ipHash: row.ip_hash ?? null,
    unitCount: typeof row.unit_count === "number" ? row.unit_count : 0,
    amountCents:
      typeof row.amount_cents === "number"
        ? row.amount_cents
        : typeof row.amount_cents === "string" && /^-?\d+$/.test(row.amount_cents)
          ? Number(row.amount_cents)
          : 0,
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
    reservationIds: readReservationIds(row.reservation_ids),
  }
}

function asDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) {
    return value
  }
  if (typeof value === "string") {
    return new Date(value)
  }
  return new Date(0)
}

function readReservationIds(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { ids?: unknown }).ids)
      ? (value as { ids: unknown[] }).ids
      : []
  return list.filter((entry): entry is string => typeof entry === "string")
}

export default BtcpayClaimModuleService
