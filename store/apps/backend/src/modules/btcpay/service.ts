import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  BtcpayClient,
  BtcpayHttpClient,
  BtcpayInvoice,
} from "./client"
import { BtcpayClaimStore } from "./claim"
import { getBtcpayClaimStore } from "./claim-registry"
import { CartSnapshotReader, getCartSnapshotReader } from "./cart-snapshot"
import { judgeInvoice } from "./invoice-decision"
import {
  BTCPAY_PENDING_LIMIT,
  DEFAULT_INVOICE_TTL_MS,
  hashClientIp,
  LimitConfig,
  PENDING_LIMIT_MESSAGE,
  PaymentStatus,
  resolveLimits,
} from "./limits"
import { centsToDecimal, majorToCents, requireCents } from "./money"
import { getBtcpayPaymentStore } from "./payment-registry"
import {
  BtcpayPaymentStore,
  MemoryBtcpayPaymentStore,
} from "./payment-store"
import { headerValue, readRawBody, verifyBtcpaySignature } from "./signature"
import { getStockReserver, noopStockReserver, StockReserver } from "./stock"

type BtcpayOptions = {
  url?: string
  storeId?: string
  apiKey?: string
  webhookSecret?: string
  allowedRedirectOrigins?: string[]
  limits?: Partial<LimitConfig>
}

type WarnLogger = {
  warn(message: string): void
}

type InjectedDependencies = {
  logger?: Logger
  client?: BtcpayClient
  claimStore?: BtcpayClaimStore
  paymentStore?: BtcpayPaymentStore
  stockReserver?: StockReserver
  cartReader?: CartSnapshotReader
}

type SessionData = {
  id: string
  invoice_id: string
  checkout_link: string
  cart_id: string
  payment_session_id: string
  amount_cents: number
  amount: string
  currency_code: "usd"
  expires_at: string
}

type ResolvedConfig = {
  url: string
  storeId: string
  apiKey: string
  webhookSecret: string
  allowedRedirectOrigins: string[]
}

export default class BtcpayPaymentProviderService extends AbstractPaymentProvider<BtcpayOptions> {
  static identifier = "btcpay"

  protected readonly logger_: WarnLogger
  protected readonly client_: BtcpayClient
  protected readonly claimStore_?: BtcpayClaimStore
  protected readonly paymentStore_?: BtcpayPaymentStore
  protected readonly stock_?: StockReserver
  protected readonly cartReader_?: CartSnapshotReader
  protected readonly limits_: LimitConfig
  protected readonly config_: ResolvedConfig
  private readonly fallbackPayments_ = new MemoryBtcpayPaymentStore()

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["url", "storeId", "apiKey", "webhookSecret"] as const) {
      if (options[key] != null && typeof options[key] !== "string") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `BTCPay provider option ${key} must be a string.`
        )
      }
    }
  }

  constructor(container: InjectedDependencies, options: BtcpayOptions = {}) {
    super(container, options)
    this.logger_ = container.logger ?? {
      warn: (message) => {
        console.warn(message)
      },
    }
    this.claimStore_ = container.claimStore
    this.paymentStore_ = container.paymentStore
    this.stock_ = container.stockReserver
    this.cartReader_ = container.cartReader
    this.limits_ = resolveLimits(options.limits)
    this.config_ = resolveConfig(options)
    this.client_ =
      container.client ??
      new BtcpayHttpClient({
        url: this.config_.url,
        storeId: this.config_.storeId,
        apiKey: this.config_.apiKey,
      })
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const session = await this.openInvoice(input)
    return {
      id: session.invoice_id,
      status: PaymentSessionStatus.PENDING,
      data: session,
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const current = readSession(input.data)
    const nextCents = requireCents(input.amount, "Payment amount")
    this.assertUsd(input.currency_code)

    if (
      current &&
      current.amount_cents === nextCents &&
      current.cart_id === readCartId(input.data) &&
      current.currency_code === "usd"
    ) {
      return { status: PaymentSessionStatus.PENDING, data: current }
    }

    const session = await this.openInvoice(input, current?.invoice_id)
    if (current?.invoice_id && current.invoice_id !== session.invoice_id) {
      await this.voidUnpaidInvoice(current.invoice_id)
      await this.releaseHold(current.invoice_id, "canceled")
    }
    return {
      status: PaymentSessionStatus.PENDING,
      data: session,
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    const current = readSession(input.data)
    if (current?.invoice_id) {
      await this.voidUnpaidInvoice(current.invoice_id)
      await this.releaseHold(current.invoice_id, "canceled")
    }
    return { data: current ?? {} }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const session = requireSession(input.data)
    const invoice = await this.client_.getInvoice(session.invoice_id)
    this.assertBinding(invoice, session)
    const verdict = judgeInvoice(invoice)

    if (verdict.outcome === "pending") {
      return {
        status: PaymentSessionStatus.PENDING,
        data: { ...session, invoice_status: invoice.status },
      }
    }

    if (verdict.outcome === "reject") {
      await this.releaseHold(session.invoice_id, closedStatus(invoice.status))
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, verdict.reason)
    }

    const claim = await this.claims().claim({
      invoiceId: invoice.id,
      cartId: session.cart_id,
      paymentSessionId: session.payment_session_id,
      amountCents: session.amount_cents,
      currencyCode: "usd",
    })

    if (claim === "replay") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "BTCPay invoice settlement is already being confirmed."
      )
    }

    await this.releaseHold(session.invoice_id, "settled")

    return {
      status: PaymentSessionStatus.CAPTURED,
      data: {
        ...session,
        invoice_status: invoice.status,
        additional_status: invoice.additionalStatus,
      },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const session = requireSession(input.data)
    const invoice = await this.client_.getInvoice(session.invoice_id)
    this.assertBinding(invoice, session)
    const verdict = judgeInvoice(invoice)
    if (verdict.outcome !== "authorize") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `BTCPay capture only records an invoice BTCPay has already settled. ${verdict.reason}`
      )
    }
    return {
      data: {
        ...session,
        invoice_status: invoice.status,
        additional_status: invoice.additionalStatus,
      },
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const session = requireSession(input.data)
    const cents = requireCents(input.amount, "Refund amount")
    if (cents <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Refund amount must be greater than 0."
      )
    }
    if (cents > session.amount_cents) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Refund amount is greater than the settled invoice amount."
      )
    }

    let pullPayment
    try {
      pullPayment = await this.client_.refundInvoice(session.invoice_id, {
        customAmount: centsToDecimal(cents),
        customCurrency: "USD",
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : "BTCPay refund failed."
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "BTCPay refunds are pull payments. The customer claims the refund from a link; this store does not push bitcoin. " +
          detail
      )
    }

    if (!pullPayment.viewLink) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "BTCPay created a refund pull payment but did not return viewLink. Open the pull payment in BTCPay Server and send that claim link to the customer. This integration does not push bitcoin."
      )
    }

    return {
      data: {
        ...session,
        refund_pull_payment_id: pullPayment.id ?? null,
        refund_view_link: pullPayment.viewLink,
      },
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const session = requireSession(input.data)
    const invoice = await this.client_.getInvoice(session.invoice_id)
    return {
      data: {
        ...session,
        invoice_status: invoice.status,
        additional_status: invoice.additionalStatus,
      },
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const session = requireSession(input.data)
    const invoice = await this.client_.getInvoice(session.invoice_id)

    if (invoice.status === "Settled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Settled BTCPay invoices cannot be canceled. Refunds create a pull payment the customer claims from viewLink. Use refund instead of cancel."
      )
    }

    if (invoice.status === "Processing") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "BTCPay has seen a payment that is not settled. Cancel is not supported after a payment is seen. Wait for Settled and refund with a pull payment, or wait until the invoice expires."
      )
    }

    if (invoice.status === "New") {
      const invalid = await this.client_.markInvoiceInvalid(invoice.id)
      return {
        data: {
          ...session,
          invoice_status: invalid.status,
        },
      }
    }

    if (invoice.status === "Expired" || invoice.status === "Invalid") {
      return {
        data: {
          ...session,
          invoice_status: invoice.status,
          cancel_note:
            "The BTCPay invoice is already closed. Cancel did not move any funds.",
        },
      }
    }

    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `BTCPay invoice ${invoice.id} is ${invoice.status || "in an unknown state"} and cannot be canceled.`
    )
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const session = requireSession(input.data)
    const invoice = await this.client_.getInvoice(session.invoice_id)
    this.assertBinding(invoice, session)
    const verdict = judgeInvoice(invoice)
    const status =
      verdict.outcome === "authorize"
        ? PaymentSessionStatus.CAPTURED
        : verdict.outcome === "pending"
          ? PaymentSessionStatus.PENDING
          : PaymentSessionStatus.CANCELED
    return {
      status,
      data: {
        ...session,
        invoice_status: invoice.status,
        additional_status: invoice.additionalStatus,
      },
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const rawBody = readRawBody(payload.rawData)
    const signature = headerValue(payload.headers, "btcpay-sig")
    if (
      rawBody == null ||
      !verifyBtcpaySignature(rawBody, signature, this.config_.webhookSecret)
    ) {
      this.logger_.warn("Rejected a BTCPay webhook with an invalid signature.")
      return unsupported()
    }

    const event = payload.data ?? {}
    const invoiceId = typeof event.invoiceId === "string" ? event.invoiceId : ""
    const eventStoreId = typeof event.storeId === "string" ? event.storeId : ""
    if (!invoiceId) {
      return unsupported()
    }
    if (eventStoreId && eventStoreId !== this.config_.storeId) {
      this.logger_.warn("Rejected a BTCPay webhook for a different store.")
      return unsupported()
    }

    let invoice: BtcpayInvoice
    try {
      invoice = await this.client_.getInvoice(invoiceId)
    } catch (error) {
      this.logger_.warn(
        `BTCPay webhook could not re-fetch invoice ${invoiceId}.`
      )
      throw error
    }

    const sessionId = stringValue(invoice.metadata.paymentSessionId)
    const cartId = stringValue(invoice.metadata.cartId) || stringValue(invoice.metadata.orderId)
    const amountCents = majorToCents(invoice.amount)
    const metadataCents = numberValue(invoice.metadata.amountCents)

    if (
      !sessionId ||
      !cartId ||
      amountCents == null ||
      invoice.storeId !== this.config_.storeId ||
      invoice.currency.toUpperCase() !== "USD" ||
      metadataCents == null ||
      metadataCents !== amountCents
    ) {
      return {
        action: PaymentActions.FAILED,
        data: {
          session_id: sessionId,
          amount: amountCents == null ? 0 : Number(centsToDecimal(amountCents)),
        },
      }
    }

    const verdict = judgeInvoice(invoice)
    if (verdict.outcome !== "authorize") {
      if (verdict.outcome === "reject") {
        await this.releaseHold(invoice.id, closedStatus(invoice.status))
      }
      return {
        action:
          verdict.outcome === "pending"
            ? PaymentActions.NOT_SUPPORTED
            : PaymentActions.FAILED,
        data: {
          session_id: sessionId,
          amount: Number(centsToDecimal(amountCents)),
        },
      }
    }

    return {
      action: PaymentActions.AUTHORIZED,
      data: {
        session_id: sessionId,
        amount: Number(centsToDecimal(amountCents)),
      },
    }
  }

  private async openInvoice(
    input: InitiatePaymentInput | UpdatePaymentInput,
    replaceInvoiceId?: string
  ): Promise<SessionData> {
    this.assertConfigured()
    this.assertUsd(input.currency_code)
    const amountCents = requireCents(input.amount, "Payment amount")
    const cartId = readCartId(input.data)
    const paymentSessionId = readSessionId(input)
    const redirectUrl = assertRedirectUrl(
      stringValue(input.data?.redirect_url),
      this.config_.allowedRedirectOrigins
    )
    const snapshot = await this.cartReader()?.read(cartId)
    const units = snapshot?.units ?? numberValue(input.data?.unit_count)
    if (units == null || units < 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay payment requires the cart quantities."
      )
    }
    const customerId =
      snapshot?.customerId ?? readCustomerId(input) ?? null
    const ipHash = hashClientIp(stringValue(input.data?.client_ip))
    const store = this.payments()
    const acquired = await store.tryAcquire({
      cartId,
      paymentSessionId,
      customerId,
      ipHash,
      units,
      now: new Date(),
      limits: this.limits_,
      replaceInvoiceId,
    })
    if (!acquired.ok) {
      this.logger_.warn(
        "Rejected a BTCPay invoice because a pending payment limit was reached."
      )
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        PENDING_LIMIT_MESSAGE,
        BTCPAY_PENDING_LIMIT
      )
    }

    const amount = centsToDecimal(amountCents)
    let invoice: BtcpayInvoice | null = null
    let reservationIds: string[] = []
    try {
      invoice = await this.client_.createInvoice({
        amount,
        currency: "USD",
        amountCents,
        cartId,
        paymentSessionId,
        redirectUrl,
      })
      if (!invoice.checkoutLink) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "BTCPay did not return a checkoutLink."
        )
      }
      reservationIds = await this.stock().reserve({
        cartId,
        invoiceId: invoice.id,
        paymentSessionId,
        units,
      })
      const expiresAt = invoiceExpiry(invoice.expirationTime)
      await store.commitInvoice({
        id: acquired.id,
        invoiceId: invoice.id,
        expiresAt,
        reservationIds,
      })
      return {
        id: invoice.id,
        invoice_id: invoice.id,
        checkout_link: assertCheckoutLink(invoice.checkoutLink, this.config_.url),
        cart_id: cartId,
        payment_session_id: paymentSessionId,
        amount_cents: amountCents,
        amount,
        currency_code: "usd",
        expires_at: expiresAt.toISOString(),
      }
    } catch (error) {
      if (invoice && reservationIds.length) {
        await this.stock()
          .release({ invoiceId: invoice.id, reservationIds })
          .catch(() => undefined)
      }
      if (invoice?.id) {
        await this.voidUnpaidInvoice(invoice.id)
      }
      await store.abort(acquired.id)
      throw error
    }
  }

  private assertBinding(invoice: BtcpayInvoice, session: SessionData) {
    if (!invoice.storeId || invoice.storeId !== this.config_.storeId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay invoice belongs to a different store."
      )
    }
    if (invoice.currency.toUpperCase() !== "USD") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `BTCPay invoice currency ${invoice.currency || "unknown"} is not USD.`
      )
    }
    const invoiceCents = majorToCents(invoice.amount)
    if (invoiceCents == null || invoiceCents !== session.amount_cents) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay invoice amount does not match the cart total."
      )
    }
    const cartId =
      stringValue(invoice.metadata.cartId) || stringValue(invoice.metadata.orderId)
    if (cartId !== session.cart_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay invoice belongs to a different cart."
      )
    }
    const paymentSessionId = stringValue(invoice.metadata.paymentSessionId)
    if (paymentSessionId !== session.payment_session_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay invoice belongs to a different payment session."
      )
    }
  }

  private async voidUnpaidInvoice(invoiceId: string) {
    try {
      const invoice = await this.client_.getInvoice(invoiceId)
      if (invoice.status === "New") {
        await this.client_.markInvoiceInvalid(invoiceId)
      }
    } catch {
      this.logger_.warn(
        `Could not invalidate unpaid BTCPay invoice ${invoiceId}.`
      )
    }
  }

  private payments(): BtcpayPaymentStore {
    return this.paymentStore_ ?? getBtcpayPaymentStore() ?? this.fallbackPayments_
  }

  private stock(): StockReserver {
    return this.stock_ ?? getStockReserver() ?? noopStockReserver
  }

  private cartReader(): CartSnapshotReader | null {
    return this.cartReader_ ?? getCartSnapshotReader()
  }

  private async releaseHold(
    invoiceId: string,
    status: Exclude<PaymentStatus, "holding" | "pending">
  ) {
    const reservationIds = await this.payments().close(invoiceId, status)
    await this.stock().release({ invoiceId, reservationIds })
  }

  private claims(): BtcpayClaimStore {
    if (this.claimStore_) {
      return this.claimStore_
    }
    const registered = getBtcpayClaimStore()
    if (!registered) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "BTCPay invoice claim store is not available."
      )
    }
    return registered
  }

  private assertConfigured() {
    if (
      !this.config_.url ||
      !this.config_.storeId ||
      !this.config_.apiKey ||
      !this.config_.webhookSecret
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay is not configured."
      )
    }
  }

  private assertUsd(currencyCode: string) {
    if (currencyCode.toLowerCase() !== "usd") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "BTCPay payments are only available in USD."
      )
    }
  }
}

function unsupported(): WebhookActionResult {
  return {
    action: PaymentActions.NOT_SUPPORTED,
    data: {
      session_id: "",
      amount: 0,
    },
  }
}

function resolveConfig(options: BtcpayOptions): ResolvedConfig {
  const url = firstString(options.url, process.env.BTCPAY_URL)
  const storeId = firstString(options.storeId, process.env.BTCPAY_STORE_ID)
  const apiKey = firstString(options.apiKey, process.env.BTCPAY_API_KEY)
  const webhookSecret = firstString(
    options.webhookSecret,
    process.env.BTCPAY_WEBHOOK_SECRET
  )
  const allowedRedirectOrigins =
    options.allowedRedirectOrigins ?? parseOrigins(process.env.STORE_CORS)
  return { url, storeId, apiKey, webhookSecret, allowedRedirectOrigins }
}

function firstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return ""
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  const origins: string[] = []
  for (const entry of value.split(",")) {
    const trimmed = entry.trim()
    if (!trimmed) {
      continue
    }
    try {
      origins.push(new URL(trimmed).origin)
    } catch {
      continue
    }
  }
  return origins
}

function assertRedirectUrl(redirectUrl: string, allowedOrigins: string[]): string {
  let url: URL
  try {
    url = new URL(redirectUrl)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay redirect URL is invalid."
    )
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay redirect URL must use http or https."
    )
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay redirect URL origin is not in STORE_CORS."
    )
  }
  if (!url.pathname.endsWith("/checkout/btcpay/return")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay redirect URL must return to /checkout/btcpay/return."
    )
  }
  return url.toString()
}

function assertCheckoutLink(checkoutLink: string, btcpayUrl: string): string {
  let actual: URL
  let expected: URL
  try {
    actual = new URL(checkoutLink)
    expected = new URL(btcpayUrl)
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BTCPay checkout link is invalid."
    )
  }
  if (actual.origin !== expected.origin) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BTCPay checkout link origin does not match BTCPAY_URL."
    )
  }
  if (actual.protocol !== "https:" && actual.protocol !== "http:") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BTCPay checkout link must use http or https."
    )
  }
  return actual.toString()
}

function readCartId(data: Record<string, unknown> | undefined): string {
  const cartId = stringValue(data?.cart_id)
  if (!cartId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay payment requires the cart id."
    )
  }
  return cartId
}

function readSessionId(
  input: InitiatePaymentInput | UpdatePaymentInput
): string {
  const fromData = stringValue(input.data?.session_id)
  const fromContext = input.context?.idempotency_key
  const sessionId =
    fromData || (typeof fromContext === "string" ? fromContext : "")
  if (!sessionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay payment requires the Medusa payment session id."
    )
  }
  return sessionId
}

function readSession(data: Record<string, unknown> | undefined): SessionData | null {
  if (!data) {
    return null
  }
  const invoiceId = stringValue(data.invoice_id) || stringValue(data.id)
  const cartId = stringValue(data.cart_id)
  const paymentSessionId = stringValue(data.payment_session_id)
  const amountCents = numberValue(data.amount_cents)
  const amount = stringValue(data.amount)
  const checkoutLink = stringValue(data.checkout_link)
  if (!invoiceId || !cartId || !paymentSessionId || amountCents == null || !amount) {
    return null
  }
  return {
    id: invoiceId,
    invoice_id: invoiceId,
    checkout_link: checkoutLink,
    cart_id: cartId,
    payment_session_id: paymentSessionId,
    amount_cents: amountCents,
    amount,
    currency_code: "usd",
    expires_at: stringValue(data.expires_at),
  }
}

function requireSession(data: Record<string, unknown> | undefined): SessionData {
  const session = readSession(data)
  if (!session) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "BTCPay payment session is missing invoice data."
    )
  }
  return session
}

function closedStatus(
  status: string
): Exclude<PaymentStatus, "holding" | "pending"> {
  if (status === "Expired") {
    return "expired"
  }
  if (status === "Invalid") {
    return "invalid"
  }
  if (status === "Settled") {
    return "settled"
  }
  return "canceled"
}

function invoiceExpiry(expirationTime: string | undefined): Date {
  if (expirationTime) {
    const parsed = new Date(expirationTime)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return new Date(Date.now() + DEFAULT_INVOICE_TTL_MS)
}

function readCustomerId(
  input: InitiatePaymentInput | UpdatePaymentInput
): string | null {
  const customer = input.context?.customer as { id?: unknown } | undefined
  if (typeof customer?.id === "string" && customer.id) {
    return customer.id
  }
  const fromData = stringValue(input.data?.customer_id)
  return fromData || null
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}
