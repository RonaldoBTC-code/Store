import { MedusaError } from "@medusajs/framework/utils"

export type BtcpayInvoice = {
  id: string
  storeId: string
  amount: string
  currency: string
  status: string
  additionalStatus: string
  checkoutLink?: string
  metadata: Record<string, unknown>
}

export type CreateInvoiceInput = {
  amount: string
  currency: "USD"
  amountCents: number
  cartId: string
  paymentSessionId: string
  redirectUrl: string
}

export type RefundInvoiceResult = {
  id?: string
  viewLink?: string
}

export interface BtcpayClient {
  createInvoice(input: CreateInvoiceInput): Promise<BtcpayInvoice>
  getInvoice(invoiceId: string): Promise<BtcpayInvoice>
  markInvoiceInvalid(invoiceId: string): Promise<BtcpayInvoice>
  refundInvoice(
    invoiceId: string,
    input: { customAmount: string; customCurrency: "USD" }
  ): Promise<RefundInvoiceResult>
}

export type BtcpayClientConfig = {
  url: string
  storeId: string
  apiKey: string
}

const INVOICE_ID = /^[A-Za-z0-9]+$/

export class BtcpayHttpClient implements BtcpayClient {
  constructor(private readonly config: BtcpayClientConfig) {}

  async createInvoice(input: CreateInvoiceInput): Promise<BtcpayInvoice> {
    const payload = await this.request(
      "POST",
      `/api/v1/stores/${encodeURIComponent(this.config.storeId)}/invoices`,
      {
        amount: input.amount,
        currency: input.currency,
        metadata: {
          orderId: input.cartId,
          cartId: input.cartId,
          paymentSessionId: input.paymentSessionId,
          amountCents: input.amountCents,
        },
        checkout: {
          redirectURL: input.redirectUrl,
          redirectAutomatically: true,
        },
      }
    )
    return normalizeInvoice(payload)
  }

  async getInvoice(invoiceId: string): Promise<BtcpayInvoice> {
    const id = assertInvoiceId(invoiceId)
    const payload = await this.request(
      "GET",
      `/api/v1/stores/${encodeURIComponent(this.config.storeId)}/invoices/${id}`
    )
    return normalizeInvoice(payload)
  }

  async markInvoiceInvalid(invoiceId: string): Promise<BtcpayInvoice> {
    const id = assertInvoiceId(invoiceId)
    const payload = await this.request(
      "POST",
      `/api/v1/stores/${encodeURIComponent(this.config.storeId)}/invoices/${id}/status`,
      { status: "Invalid" }
    )
    return normalizeInvoice(payload)
  }

  async refundInvoice(
    invoiceId: string,
    input: { customAmount: string; customCurrency: "USD" }
  ): Promise<RefundInvoiceResult> {
    const id = assertInvoiceId(invoiceId)
    const payload = await this.request(
      "POST",
      `/api/v1/stores/${encodeURIComponent(this.config.storeId)}/invoices/${id}/refund`,
      {
        refundVariant: "Custom",
        customAmount: input.customAmount,
        customCurrency: input.customCurrency,
      }
    )
    const record = asRecord(payload)
    return {
      id: typeof record.id === "string" ? record.id : undefined,
      viewLink: typeof record.viewLink === "string" ? record.viewLink : undefined,
    }
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const base = this.config.url.replace(/\/+$/, "")
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: {
          Authorization: `token ${this.config.apiKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : "request failed"
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `BTCPay request failed: ${redact(reason, this.config.apiKey)}`
      )
    }

    if (response.status >= 300 && response.status < 400) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `BTCPay redirected an API call (${response.status}).`
      )
    }

    const text = await response.text()
    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `BTCPay returned ${response.status}: ${redact(text.slice(0, 500), this.config.apiKey)}`
      )
    }

    if (!text) {
      return {}
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "BTCPay returned a response that was not JSON."
      )
    }
  }
}

function assertInvoiceId(invoiceId: string): string {
  if (!INVOICE_ID.test(invoiceId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid BTCPay invoice id."
    )
  }
  return invoiceId
}

function normalizeInvoice(payload: unknown): BtcpayInvoice {
  const record = asRecord(payload)
  if (typeof record.id !== "string" || !record.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BTCPay invoice response did not include an id."
    )
  }
  const metadata = asRecord(record.metadata)
  return {
    id: record.id,
    storeId: typeof record.storeId === "string" ? record.storeId : "",
    amount: record.amount == null ? "" : String(record.amount),
    currency: typeof record.currency === "string" ? record.currency : "",
    status: typeof record.status === "string" ? record.status : "",
    additionalStatus:
      typeof record.additionalStatus === "string"
        ? record.additionalStatus
        : "None",
    checkoutLink:
      typeof record.checkoutLink === "string" ? record.checkoutLink : undefined,
    metadata,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function redact(text: string, secret: string): string {
  if (!secret) {
    return text
  }
  return text.split(secret).join("[redacted]")
}
