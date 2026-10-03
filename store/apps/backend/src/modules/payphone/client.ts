import { splitInclusiveIva, type PayphoneAmountSplit } from "./amounts"

/**
 * Official Botón de Pago hosts. Do not point these at a guessed URL.
 * Prepare and confirm: https://docs.payphone.app/boton-de-pago
 * Reverse: https://docs.payphone.app/api-reverse
 */
export const PAYPHONE_API_BASE = "https://pay.payphonetodoesposible.com"
export const PAYPHONE_PAYMENT_HOST = "pay.payphonetodoesposible.com"
const PREPARE_PATH = "/api/button/Prepare"
const CONFIRM_PATH = "/api/button/V2/Confirm"
const REVERSE_PATH = "/api/Reverse"

export type PayphonePrepareResult = {
  paymentId: string
  payWithCard: string
  payWithPayPhone: string
}

export type PayphoneTransaction = {
  amount?: number
  clientTransactionId?: string
  statusCode?: number
  transactionStatus?: string
  authorizationCode?: string | null
  message?: string | null
  messageCode?: number
  transactionId?: number
  currency?: string
  date?: string
  cardBrand?: string
  lastDigits?: string
}

export type PayphoneClientOptions = {
  token: string
  storeId: string
  responseUrl: string
  cancellationUrl: string
  fetchImpl?: typeof fetch
  apiBase?: string
}

export class PayphoneApiError extends Error {
  readonly status: number
  readonly errorCode?: number

  constructor(message: string, status: number, errorCode?: number) {
    super(message)
    this.name = "PayphoneApiError"
    this.status = status
    this.errorCode = errorCode
  }
}

export class PayphoneClient {
  private readonly token: string
  private readonly storeId: string
  private readonly responseUrl: string
  private readonly cancellationUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly apiBase: string

  constructor(options: PayphoneClientOptions) {
    this.token = options.token
    this.storeId = options.storeId
    this.responseUrl = options.responseUrl
    this.cancellationUrl = options.cancellationUrl
    this.fetchImpl = options.fetchImpl ?? fetch
    this.apiBase = options.apiBase ?? PAYPHONE_API_BASE
  }

  async prepare(input: {
    clientTransactionId: string
    split: PayphoneAmountSplit
  }): Promise<PayphonePrepareResult> {
    const body = {
      amount: input.split.amount,
      amountWithoutTax: input.split.amountWithoutTax,
      amountWithTax: input.split.amountWithTax,
      tax: input.split.tax,
      service: input.split.service,
      tip: input.split.tip,
      clientTransactionId: input.clientTransactionId,
      reference: "Gato Gang",
      storeId: this.storeId,
      currency: "USD",
      responseUrl: this.responseUrl,
      cancellationUrl: this.cancellationUrl,
      timeZone: -5,
      lang: "es",
    }
    const payload = await this.post(PREPARE_PATH, body)
    const paymentId = readString(payload, "paymentId")
    const payWithCard = readString(payload, "payWithCard")
    const payWithPayPhone = readString(payload, "payWithPayPhone")

    if (!paymentId || !payWithCard || !payWithPayPhone) {
      throw new PayphoneApiError(
        "La respuesta de preparación de PayPhone no incluye los enlaces de pago.",
        502
      )
    }

    assertPayphonePaymentUrl(payWithCard)
    assertPayphonePaymentUrl(payWithPayPhone)

    return { paymentId, payWithCard, payWithPayPhone }
  }

  async confirm(
    id: number,
    clientTxId: string
  ): Promise<PayphoneTransaction> {
    const payload = await this.post(CONFIRM_PATH, { id, clientTxId })
    return readTransaction(payload)
  }

  async reverse(transactionId: number): Promise<void> {
    const payload = await this.post(REVERSE_PATH, { id: transactionId })

    if (payload === true) {
      return
    }

    throw new PayphoneApiError(
      "PayPhone no confirmó el reverso.",
      502
    )
  }

  private async post(path: string, body: Record<string, unknown> | object) {
    let response: Response

    try {
      response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "error de red"
      throw new PayphoneApiError(
        `No se pudo contactar a PayPhone (${message}).`,
        502
      )
    }

    const text = await response.text()
    const parsed = parseBody(text)

    if (!response.ok) {
      throw errorFromPayload(parsed, response.status)
    }

    if (isErrorPayload(parsed)) {
      throw errorFromPayload(parsed, response.status)
    }

    return parsed
  }
}

export function assertPayphonePaymentUrl(url: string) {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new PayphoneApiError("PayPhone devolvió un enlace de pago inválido.", 502)
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== PAYPHONE_PAYMENT_HOST ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    throw new PayphoneApiError(
      "PayPhone devolvió un enlace de pago fuera de su dominio.",
      502
    )
  }
}

export function buildPrepareSplit(amount: Parameters<typeof splitInclusiveIva>[0]) {
  return splitInclusiveIva(amount)
}

function parseBody(text: string): unknown {
  const trimmed = text.trim()

  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    if (trimmed === "true") {
      return true
    }

    if (trimmed === "false") {
      return false
    }

    return trimmed
  }
}

function isErrorPayload(payload: unknown): payload is { message?: string; errorCode?: number } {
  return (
    payload != null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "errorCode" in payload &&
    !("transactionStatus" in payload) &&
    !("paymentId" in payload)
  )
}

function errorFromPayload(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as { message?: unknown; errorCode?: unknown }
    const message =
      typeof record.message === "string" && record.message
        ? record.message
        : "PayPhone rechazó la solicitud."
    const errorCode =
      typeof record.errorCode === "number" ? record.errorCode : undefined

    return new PayphoneApiError(message, status, errorCode)
  }

  return new PayphoneApiError("PayPhone rechazó la solicitud.", status)
}

function readString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const value = (payload as Record<string, unknown>)[key]
  return typeof value === "string" && value ? value : undefined
}

function readTransaction(payload: unknown): PayphoneTransaction {
  if (!payload || typeof payload !== "object") {
    throw new PayphoneApiError(
      "La confirmación de PayPhone no devolvió una transacción.",
      502
    )
  }

  const record = payload as Record<string, unknown>

  return {
    amount: typeof record.amount === "number" ? record.amount : undefined,
    clientTransactionId:
      typeof record.clientTransactionId === "string"
        ? record.clientTransactionId
        : undefined,
    statusCode:
      typeof record.statusCode === "number" ? record.statusCode : undefined,
    transactionStatus:
      typeof record.transactionStatus === "string"
        ? record.transactionStatus
        : undefined,
    authorizationCode:
      typeof record.authorizationCode === "string"
        ? record.authorizationCode
        : null,
    message: typeof record.message === "string" ? record.message : null,
    messageCode:
      typeof record.messageCode === "number" ? record.messageCode : undefined,
    transactionId:
      typeof record.transactionId === "number" ? record.transactionId : undefined,
    currency: typeof record.currency === "string" ? record.currency : undefined,
    date: typeof record.date === "string" ? record.date : undefined,
    cardBrand: typeof record.cardBrand === "string" ? record.cardBrand : undefined,
    lastDigits:
      typeof record.lastDigits === "string" ? record.lastDigits : undefined,
  }
}
