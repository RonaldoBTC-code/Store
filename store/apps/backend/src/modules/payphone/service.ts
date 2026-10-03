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
  BigNumberInput,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import {
  centsToUsd,
  splitFromCartTotals,
  toUsdCents,
  type PayphoneAmountSplit,
} from "./amounts"
import {
  assertPayphonePaymentUrl,
  PayphoneApiError,
  PayphoneClient,
  type PayphoneHttpClient,
  type PayphoneTransaction,
} from "./client"
import { payphoneReverseAllowed } from "./reverse-window"

const CLIENT_TX_MAX = 50

export const PayphoneResultCode = {
  declined: "PAYPHONE_DECLINED",
  cancelled: "PAYPHONE_CANCELLED",
  mismatch: "PAYPHONE_MISMATCH",
  pending: "PAYPHONE_PENDING",
  failed: "PAYPHONE_FAILED",
  amount: "PAYPHONE_AMOUNT",
  currency: "PAYPHONE_CURRENCY",
  client: "PAYPHONE_CLIENT",
  cartChanged: "PAYPHONE_CART_CHANGED",
  inProgress: "PAYPHONE_IN_PROGRESS",
} as const

export const PAYPHONE_SHOPPER_COPY = {
  declined: "PayPhone rechazó el pago. No se creó el pedido.",
  cancelled: "Cancelaste el pago en PayPhone. No se creó el pedido.",
  mismatch:
    "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido.",
  pending: "El pago en PayPhone todavía no está aprobado. No se creó el pedido.",
  failed: "No pudimos confirmar el pago con PayPhone. No se creó el pedido.",
  amount:
    "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido.",
  currency: "La moneda del pago no es USD. No se creó el pedido.",
  client: "Esta transacción no corresponde a tu pedido. No se creó el pedido.",
  cart_changed:
    "Tu pedido cambió después de iniciar el pago. No se creó el pedido.",
  in_progress:
    "Este pago ya se está procesando. Espera un momento y no vuelvas a confirmar.",
} as const

export type PayphoneShopperCode = keyof typeof PAYPHONE_SHOPPER_COPY

const SHOPPER_RESULT_CODE: Record<PayphoneShopperCode, string> = {
  declined: PayphoneResultCode.declined,
  cancelled: PayphoneResultCode.cancelled,
  mismatch: PayphoneResultCode.mismatch,
  pending: PayphoneResultCode.pending,
  failed: PayphoneResultCode.failed,
  amount: PayphoneResultCode.amount,
  currency: PayphoneResultCode.currency,
  client: PayphoneResultCode.client,
  cart_changed: PayphoneResultCode.cartChanged,
  in_progress: PayphoneResultCode.inProgress,
}

export function payphoneShopperError(code: PayphoneShopperCode) {
  return new MedusaError(
    MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
    `${SHOPPER_RESULT_CODE[code]}:${PAYPHONE_SHOPPER_COPY[code]}`
  )
}

export type PayphoneProviderOptions = {
  token?: string
  storeId?: string
  responseUrl?: string
  cancellationUrl?: string
  /**
   * Injected transport. Tests pass a fake so CI never needs PayPhone keys
   * and never calls the network. Production leaves this unset.
   */
  client?: PayphoneHttpClient
}

type SessionData = Record<string, unknown>

/**
 * PayPhone Botón de Pago (redirect). The browser never decides the result:
 * authorizePayment posts id + clientTxId to Confirm and checks the body.
 * https://docs.payphone.app/boton-de-pago
 *
 * Notificación externa has no documented signature. getWebhookActionAndData
 * re-confirms with PayPhone before returning a session id.
 * https://docs.payphone.app/notificacion-externa
 *
 * There is no capture API for this flow. Reverse is same-day, full amount,
 * until 20:00 Ecuador. https://docs.payphone.app/api-reverse
 */
class PayphoneProviderService extends AbstractPaymentProvider<PayphoneProviderOptions> {
  static identifier = "payphone"

  protected logger_: Logger
  protected options_: PayphoneProviderOptions
  protected client_: PayphoneHttpClient

  constructor(container: { logger: Logger }, options: PayphoneProviderOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.client_ =
      options.client ??
      new PayphoneClient({
        token: options.token ?? "",
        storeId: options.storeId ?? "",
        responseUrl: options.responseUrl ?? "",
        cancellationUrl: options.cancellationUrl ?? "",
      })
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    this.assertConfigured()

    const currency = input.currency_code?.toLowerCase()
    if (currency !== "usd") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPhone solo está habilitado para USD."
      )
    }

    const split = splitForCharge(input.amount, input.data)
    if (split.amount <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "El monto a cobrar debe ser mayor a cero."
      )
    }

    const sessionId = readSessionId(input.data, input.context?.idempotency_key)
    assertClientTransactionId(sessionId)

    try {
      const prepared = await this.client_.prepare({
        clientTransactionId: sessionId,
        split,
      })
      assertPayphonePaymentUrl(prepared.payWithCard)
      assertPayphonePaymentUrl(prepared.payWithPayPhone)

      return {
        id: sessionId,
        status: PaymentSessionStatus.PENDING,
        data: sessionData({
          sessionId,
          split,
          paymentId: prepared.paymentId,
          payWithCard: prepared.payWithCard,
          payWithPayPhone: prepared.payWithPayPhone,
          cartTaxTotal: input.data?.cart_tax_total,
          cartUntaxedTotal: input.data?.cart_untaxed_total ?? 0,
        }),
      }
    } catch (error) {
      throw this.asMedusaError(error, "No pudimos iniciar el pago con PayPhone.")
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    this.assertConfigured()

    const current = input.data ?? {}
    const sessionId = readSessionId(current, input.context?.idempotency_key)
    assertClientTransactionId(sessionId)

    const previousCents = readNumber(current.amount_cents)
    const payphoneTransactionId = readOptionalId(current.payphone_transaction_id)
    const payWithCard = readString(current.pay_with_card)
    const payWithPayPhone = readString(current.pay_with_payphone)
    const urlsAreTrusted = trustedPayphoneUrls(payWithCard, payWithPayPhone)
    const inputCents = toUsdCents(input.amount)

    if (
      previousCents != null &&
      previousCents === inputCents &&
      payphoneTransactionId &&
      urlsAreTrusted &&
      isServerConfirmed(current, sessionId, payphoneTransactionId, previousCents)
    ) {
      return {
        status: PaymentSessionStatus.PENDING,
        data: {
          ...current,
          ...confirmedSnapshot(current),
          client_transaction_id: sessionId,
          amount_cents: previousCents,
          payphone_transaction_id: payphoneTransactionId,
        },
      }
    }

    const split = splitForCharge(input.amount, current)
    const unchanged = previousCents === split.amount && urlsAreTrusted

    if (unchanged && payWithCard && payWithPayPhone) {
      const next = sessionData({
        sessionId,
        split,
        paymentId: readString(current.payment_id) ?? "",
        payWithCard,
        payWithPayPhone,
        cartTaxTotal: current.cart_tax_total,
        cartUntaxedTotal: current.cart_untaxed_total ?? 0,
      })

      if (
        payphoneTransactionId &&
        isServerConfirmed(current, sessionId, payphoneTransactionId, split.amount)
      ) {
        return {
          status: PaymentSessionStatus.PENDING,
          data: {
            ...next,
            ...confirmedSnapshot(current),
            payphone_transaction_id: payphoneTransactionId,
          },
        }
      }

      return {
        status: PaymentSessionStatus.PENDING,
        data: {
          ...next,
          ...(payphoneTransactionId
            ? { payphone_transaction_id: payphoneTransactionId }
            : {}),
        },
      }
    }

    if (split.amount <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "El monto a cobrar debe ser mayor a cero."
      )
    }

    try {
      const prepared = await this.client_.prepare({
        clientTransactionId: sessionId,
        split,
      })
      assertPayphonePaymentUrl(prepared.payWithCard)
      assertPayphonePaymentUrl(prepared.payWithPayPhone)

      return {
        status: PaymentSessionStatus.PENDING,
        data: sessionData({
          sessionId,
          split,
          paymentId: prepared.paymentId,
          payWithCard: prepared.payWithCard,
          payWithPayPhone: prepared.payWithPayPhone,
          cartTaxTotal: current.cart_tax_total,
          cartUntaxedTotal: current.cart_untaxed_total ?? 0,
        }),
      }
    } catch (error) {
      throw this.asMedusaError(error, "No pudimos actualizar el pago con PayPhone.")
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Prepare only opens a form. PayPhone does not document a way to void it.
    // The link expires about 10 minutes after it is opened.
    return { data: input.data ?? {} }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    this.assertConfigured()

    const data = input.data ?? {}
    const sessionId = readSessionId(data, input.context?.idempotency_key)
    assertClientTransactionId(sessionId)

    const expectedCents = readNumber(data.amount_cents)
    if (expectedCents == null) {
      throw codedError(
        PayphoneResultCode.failed,
        "No pudimos confirmar el pago con PayPhone."
      )
    }

    const payphoneId = readOptionalId(data.payphone_transaction_id)
    if (!payphoneId) {
      throw codedError(
        PayphoneResultCode.pending,
        "El pago en PayPhone todavía no se ha completado."
      )
    }

    if (isServerConfirmed(data, sessionId, payphoneId, expectedCents)) {
      return {
        status: PaymentSessionStatus.CAPTURED,
        data,
      }
    }

    let transaction: PayphoneTransaction

    try {
      transaction = await this.client_.confirm(payphoneId, sessionId)
    } catch (error) {
      throw this.asMedusaError(
        error,
        "No pudimos confirmar el pago con PayPhone."
      )
    }

    const outcome = classifyTransaction(transaction)

    if (outcome !== "approved") {
      throw codedError(
        outcome === "cancelled"
          ? PayphoneResultCode.cancelled
          : outcome === "pending"
            ? PayphoneResultCode.pending
            : PayphoneResultCode.declined,
        shopperMessage(outcome)
      )
    }

    const amountMatches = transaction.amount === expectedCents
    const clientMatches = transaction.clientTransactionId === sessionId
    const currencyMatches = (transaction.currency ?? "USD").toUpperCase() === "USD"

    if (!amountMatches || !clientMatches || !currencyMatches) {
      await this.reverseMismatched(transaction)
      throw codedError(
        PayphoneResultCode.mismatch,
        "El monto que confirmó PayPhone no coincide con tu pedido. No se creó el pedido."
      )
    }

    return {
      status: PaymentSessionStatus.CAPTURED,
      data: confirmedData(data, transaction, sessionId, expectedCents),
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = input.data ?? {}
    if (
      data.payphone_confirmed === true &&
      data.transaction_status === "Approved" &&
      data.transaction_id
    ) {
      // Confirm already accepts the sale. Returning "captured" from
      // authorizePayment makes Medusa skip a second provider capture.
      // This method stays idempotent for a later admin capture attempt.
      return { data }
    }

    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "PayPhone cobra el Botón de Pago al confirmar. No hay una API de captura separada."
    )
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = input.data ?? {}
    const transactionId = readOptionalId(data.transaction_id)

    if (data.transaction_status !== "Approved" || !transactionId) {
      return { data }
    }

    await this.reverseOrThrow(transactionId, readString(data.transaction_date))

    return {
      data: {
        ...data,
        transaction_status: "Canceled",
      },
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = input.data ?? {}
    const originalCents = readNumber(data.amount_cents)
    const requestedCents = toUsdCents(input.amount)
    const transactionId = readOptionalId(data.transaction_id)

    if (!transactionId || originalCents == null) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No hay una transacción de PayPhone para reversar."
      )
    }

    if (requestedCents !== originalCents) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "PayPhone no documenta reembolsos parciales. El reverso por API es por el monto total, el mismo día, hasta las 20:00 (Ecuador)."
      )
    }

    await this.reverseOrThrow(transactionId, readString(data.transaction_date))

    return {
      data: {
        ...data,
        transaction_status: "Canceled",
        refunded_cents: requestedCents,
      },
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    // Confirm is the acceptance call, not a documented read. Returning the
    // data we already verified avoids confirming a payment by polling.
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = input.data ?? {}
    const status = readString(data.transaction_status)

    if (status === "Approved") {
      return { status: PaymentSessionStatus.CAPTURED, data }
    }

    if (status === "Canceled") {
      return { status: PaymentSessionStatus.CANCELED, data }
    }

    return { status: PaymentSessionStatus.PENDING, data }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const body = readWebhookBody(payload?.data)
    const storeId = readString(body.StoreId) ?? readString(body.storeId)
    const clientTransactionId =
      readString(body.ClientTransactionId) ??
      readString(body.clientTransactionId)
    const transactionId = readOptionalId(body.TransactionId ?? body.transactionId)

    if (storeId && storeId !== this.options_.storeId) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    if (!clientTransactionId || !transactionId) {
      return { action: PaymentActions.FAILED }
    }

    this.assertConfigured()

    let transaction: PayphoneTransaction

    try {
      transaction = await this.client_.confirm(transactionId, clientTransactionId)
    } catch (error) {
      this.logger_?.error?.(
        `PayPhone webhook confirm failed: ${safeLogDetail(error)}`
      )
      return { action: PaymentActions.FAILED }
    }

    if (
      classifyTransaction(transaction) !== "approved" ||
      transaction.clientTransactionId !== clientTransactionId ||
      (transaction.currency ?? "USD").toUpperCase() !== "USD" ||
      typeof transaction.amount !== "number"
    ) {
      return { action: PaymentActions.FAILED }
    }

    return {
      action: PaymentActions.SUCCESSFUL,
      data: {
        session_id: clientTransactionId,
        amount: new BigNumber(centsToUsd(transaction.amount)),
      },
    }
  }

  private assertConfigured() {
    if (this.options_.client) {
      return
    }

    if (
      !this.options_.token ||
      !this.options_.storeId ||
      !this.options_.responseUrl ||
      !this.options_.cancellationUrl
    ) {
      this.logger_?.error?.("PayPhone provider is not configured.")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No pudimos iniciar el pago con PayPhone."
      )
    }
  }

  private async reverseMismatched(transaction: PayphoneTransaction) {
    if (!transaction.transactionId) {
      this.logger_?.error?.(
        "PayPhone confirm mismatched and did not return transactionId, so it was not reversed."
      )
      return
    }

    try {
      await this.client_.reverse(transaction.transactionId)
    } catch (error) {
      this.logger_?.error?.(
        `PayPhone amount mismatch reverse failed for ${transaction.transactionId}: ${safeLogDetail(error)}`
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "El pago quedó confirmado en PayPhone con un monto distinto y el reverso falló. Revierte la transacción en Payphone Business. No se creó el pedido."
      )
    }
  }

  private async reverseOrThrow(
    transactionId: number,
    transactionDate: string | undefined
  ) {
    const allowed = payphoneReverseAllowed(transactionDate, new Date())

    if (allowed === false) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "PayPhone solo permite el reverso el mismo día, hasta las 20:00 (hora de Ecuador)."
      )
    }

    try {
      await this.client_.reverse(transactionId)
    } catch (error) {
      throw this.asMedusaError(
        error,
        "PayPhone no pudo reversar la transacción."
      )
    }
  }

  private asMedusaError(error: unknown, fallback: string) {
    if (error instanceof MedusaError) {
      return error
    }

    this.logger_?.error?.(`PayPhone request failed: ${safeLogDetail(error)}`)

    const code =
      error instanceof PayphoneApiError ? PayphoneResultCode.failed : PayphoneResultCode.failed

    return codedError(code, fallback)
  }
}

function sessionData(input: {
  sessionId: string
  split: PayphoneAmountSplit
  paymentId: string
  payWithCard: string
  payWithPayPhone: string
  cartTaxTotal: unknown
  cartUntaxedTotal: unknown
}): SessionData {
  return {
    id: input.sessionId,
    session_id: input.sessionId,
    client_transaction_id: input.sessionId,
    payment_id: input.paymentId,
    pay_with_card: input.payWithCard,
    pay_with_payphone: input.payWithPayPhone,
    amount_cents: input.split.amount,
    amount_with_tax_cents: input.split.amountWithTax,
    amount_without_tax_cents: input.split.amountWithoutTax,
    tax_cents: input.split.tax,
    service_cents: input.split.service,
    tip_cents: input.split.tip,
    cart_tax_total: input.cartTaxTotal,
    cart_untaxed_total: input.cartUntaxedTotal,
    currency_code: "usd",
    payphone_confirmed: false,
    transaction_status: "Pending",
    transaction_id: null,
  }
}

export function isServerConfirmed(
  data: SessionData,
  sessionId: string,
  payphoneId: number,
  expectedCents: number
): boolean {
  return (
    data.payphone_confirmed === true &&
    data.transaction_status === "Approved" &&
    readOptionalId(data.transaction_id) === payphoneId &&
    readString(data.client_transaction_id) === sessionId &&
    readNumber(data.amount_cents) === expectedCents
  )
}

function confirmedSnapshot(data: SessionData): SessionData {
  return {
    payphone_confirmed: true,
    transaction_status: "Approved",
    transaction_id: data.transaction_id,
    authorization_code: data.authorization_code,
    transaction_date: data.transaction_date,
    status_code: data.status_code,
    card_brand: data.card_brand,
    last_digits: data.last_digits,
  }
}

export function buildConfirmedSessionData(
  previous: SessionData,
  transaction: PayphoneTransaction,
  sessionId: string,
  expectedCents: number
): SessionData {
  return confirmedData(previous, transaction, sessionId, expectedCents)
}

function confirmedData(
  previous: SessionData,
  transaction: PayphoneTransaction,
  sessionId: string,
  expectedCents: number
): SessionData {
  return {
    id: sessionId,
    session_id: sessionId,
    client_transaction_id: sessionId,
    payment_id: previous.payment_id,
    pay_with_card: previous.pay_with_card,
    pay_with_payphone: previous.pay_with_payphone,
    amount_cents: expectedCents,
    amount_with_tax_cents: previous.amount_with_tax_cents,
    amount_without_tax_cents: previous.amount_without_tax_cents,
    tax_cents: previous.tax_cents,
    cart_tax_total: previous.cart_tax_total,
    cart_untaxed_total: previous.cart_untaxed_total,
    currency_code: "usd",
    payphone_confirmed: true,
    payphone_transaction_id: transaction.transactionId,
    transaction_id: transaction.transactionId,
    transaction_status: "Approved",
    status_code: transaction.statusCode,
    authorization_code: transaction.authorizationCode,
    transaction_date: transaction.date,
    card_brand: transaction.cardBrand,
    last_digits: transaction.lastDigits,
  }
}

export function classifyTransaction(
  transaction: PayphoneTransaction
): "approved" | "cancelled" | "declined" | "pending" {
  const code = transaction.statusCode
  const status = transaction.transactionStatus?.toLowerCase()

  if (code === 3 && status === "approved") {
    return "approved"
  }

  if (code === 1 || status === "pending") {
    return "pending"
  }

  if (code === 2 || status === "canceled" || status === "cancelled") {
    // The button docs only list Approved and Canceled. A bank decline is also
    // statusCode 2. A message distinguishes the shopper copy; both block the order.
    return transaction.message ? "declined" : "cancelled"
  }

  return "declined"
}

function shopperMessage(
  outcome: "approved" | "cancelled" | "declined" | "pending"
) {
  if (outcome === "cancelled") {
    return PAYPHONE_SHOPPER_COPY.cancelled
  }

  if (outcome === "pending") {
    return PAYPHONE_SHOPPER_COPY.pending
  }

  return PAYPHONE_SHOPPER_COPY.declined
}

function codedError(code: string, message: string) {
  return new MedusaError(
    MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
    `${code}:${message}`
  )
}

export function classifyPayphoneMessage(
  message: string | undefined
): PayphoneShopperCode {
  if (!message) {
    return "failed"
  }

  if (message.includes(PayphoneResultCode.declined)) {
    return "declined"
  }

  if (message.includes(PayphoneResultCode.cancelled)) {
    return "cancelled"
  }

  if (message.includes(PayphoneResultCode.amount)) {
    return "amount"
  }

  if (message.includes(PayphoneResultCode.currency)) {
    return "currency"
  }

  if (message.includes(PayphoneResultCode.client)) {
    return "client"
  }

  if (message.includes(PayphoneResultCode.cartChanged)) {
    return "cart_changed"
  }

  if (message.includes(PayphoneResultCode.inProgress)) {
    return "in_progress"
  }

  if (message.includes(PayphoneResultCode.mismatch)) {
    return "mismatch"
  }

  if (message.includes(PayphoneResultCode.pending)) {
    return "pending"
  }

  return "failed"
}

function splitForCharge(
  amount: BigNumberInput,
  data: Record<string, unknown> | undefined
): PayphoneAmountSplit {
  if (data?.cart_tax_total == null || data.cart_tax_total === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No pudimos calcular el IVA del pedido."
    )
  }

  return splitFromCartTotals({
    total: amount,
    taxTotal: data.cart_tax_total as BigNumberInput,
    untaxedTotal: (data.cart_untaxed_total ?? 0) as BigNumberInput,
  })
}

function readSessionId(
  data: Record<string, unknown> | undefined,
  idempotencyKey: unknown
): string {
  const fromKey = readString(idempotencyKey)
  if (fromKey) {
    return fromKey
  }

  return readString(data?.session_id) ?? readString(data?.id) ?? ""
}

function assertClientTransactionId(value: string) {
  if (!value || value.length > CLIENT_TX_MAX) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No pudimos iniciar el pago con PayPhone."
    )
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readOptionalId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}

function trustedPayphoneUrls(
  payWithCard: string | undefined,
  payWithPayPhone: string | undefined
) {
  if (!payWithCard || !payWithPayPhone) {
    return false
  }

  try {
    assertPayphonePaymentUrl(payWithCard)
    assertPayphonePaymentUrl(payWithPayPhone)
    return true
  } catch {
    return false
  }
}

function safeLogDetail(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown"
  if (/bearer\s+\S+/i.test(message) || message.includes("PAYPHONE_TOKEN")) {
    return "unknown"
  }

  return message
}

function readWebhookBody(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {}
  }

  return data as Record<string, unknown>
}

export default PayphoneProviderService
