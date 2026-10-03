import { createHmac } from "crypto"
import { MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { BtcpayClient, BtcpayHttpClient, BtcpayInvoice } from "../client"
import { claimOnce, MemoryBtcpayClaimStore } from "../claim"
import {
  BTCPAY_PENDING_LIMIT,
  hashSessionId,
  PENDING_LIMIT_MESSAGE,
  resolveLimits,
} from "../limits"
import { MemoryBtcpayPaymentStore } from "../payment-store"
import BtcpayPaymentProviderService from "../service"
import { StockReserver } from "../stock"

const SECRET = "webhook-secret"
const ORIGIN = "https://btcpay.example"

function invoice(overrides: Partial<BtcpayInvoice> = {}): BtcpayInvoice {
  return {
    id: "inv123",
    storeId: "store123",
    amount: "10.00",
    currency: "USD",
    status: "Settled",
    additionalStatus: "None",
    checkoutLink: `${ORIGIN}/i/inv123`,
    metadata: {
      orderId: "cart_1",
      cartId: "cart_1",
      paymentSessionId: "payses_1",
      amountCents: 1000,
    },
    ...overrides,
  }
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv123",
    invoice_id: "inv123",
    checkout_link: `${ORIGIN}/i/inv123`,
    cart_id: "cart_1",
    payment_session_id: "payses_1",
    amount_cents: 1000,
    amount: "10.00",
    currency_code: "usd",
    ...overrides,
  }
}

function provider(
  client: BtcpayClient,
  claimStore = new MemoryBtcpayClaimStore(),
  extra: {
    paymentStore?: MemoryBtcpayPaymentStore
    stock?: StockReserver
    logger?: { warn(message: string): void }
    limits?: {
      maxPendingPerCart?: number
      maxPendingPerSession?: number
      maxPendingPerCustomer?: number
      maxNewInvoicesPerIp?: number
      newInvoiceWindowSeconds?: number
      maxUnitsPerPendingOrder?: number
    }
  } = {}
) {
  return new BtcpayPaymentProviderService(
    {
      logger: extra.logger,
      client,
      claimStore,
      paymentStore: extra.paymentStore,
      stockReserver: extra.stock,
    },
    {
      url: ORIGIN,
      storeId: "store123",
      apiKey: "test-key",
      webhookSecret: SECRET,
      allowedRedirectOrigins: ["http://localhost:8000"],
      limits: extra.limits,
    }
  )
}

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

function bindingSecret() {
  const dedicated = process.env.BTCPAY_PII_HMAC_SECRET?.trim()
  return dedicated || SECRET
}

async function seedPayment(store: MemoryBtcpayPaymentStore) {
  const acquired = await store.tryAcquire({
    cartId: "cart_1",
    paymentSessionId: hashSessionId("payses_1", bindingSecret()) ?? "",
    customerId: null,
    ipHash: null,
    units: 1,
    amountCents: 1000,
    now: new Date("2026-01-01T00:00:00.000Z"),
    limits: resolveLimits({
      maxPendingPerSession: 5,
      maxPendingPerCustomer: 5,
      maxNewInvoicesPerIp: 5,
      maxUnitsPerPendingOrder: 5,
    }),
  })
  if (!acquired.ok) {
    throw new Error("seed failed")
  }
  await store.commitInvoice({
    id: acquired.id,
    invoiceId: "inv123",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    reservationIds: [],
  })
  return store
}

async function ready(
  client: BtcpayClient,
  extra: {
    stock?: StockReserver
    logger?: { warn(message: string): void }
    claimStore?: MemoryBtcpayClaimStore
  } = {}
) {
  const payments = new MemoryBtcpayPaymentStore()
  await seedPayment(payments)
  const service = provider(client, extra.claimStore ?? new MemoryBtcpayClaimStore(), {
    paymentStore: payments,
    stock: extra.stock,
    logger: extra.logger,
  })
  return { service, payments }
}

function webhook(
  service: BtcpayPaymentProviderService,
  body: Record<string, unknown>,
  header?: string
) {
  const raw = JSON.stringify(body)
  return service.getWebhookActionAndData({
    data: body,
    rawData: raw,
    headers: {
      "btcpay-sig": header ?? sign(raw),
    },
  })
}

describe("BTCPay payment provider", () => {
  it("creates a USD invoice tied to the cart and payment session", async () => {
    const client = mockClient()
    client.createInvoice.mockResolvedValue(invoice())
    const service = provider(client)

    const result = await service.initiatePayment({
      amount: "10.00",
      currency_code: "usd",
      data: {
        cart_id: "cart_1",
        session_id: "payses_1",
        unit_count: 1,
        redirect_url: "http://localhost:8000/ec/checkout/btcpay/return",
      },
    })

    expect(client.createInvoice).toHaveBeenCalledWith({
      amount: "10.00",
      currency: "USD",
      amountCents: 1000,
      cartId: "cart_1",
      paymentSessionId: "payses_1",
      redirectUrl: "http://localhost:8000/ec/checkout/btcpay/return",
    })
    expect(result.data).toEqual(expect.objectContaining({ invoice_id: "inv123" }))
  })

  it("authorizes only a settled invoice and captures it in Medusa", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(invoice())
    const { service } = await ready(client)

    const authorized = await service.authorizePayment({ data: sessionData() })
    const action = await webhook(service, {
      type: "InvoiceSettled",
      invoiceId: "inv123",
      storeId: "store123",
      deliveryId: "deliv1",
    })

    expect(authorized.status).toBe("captured")
    expect(action).toEqual({
      action: PaymentActions.AUTHORIZED,
      data: { session_id: "payses_1", amount: 10 },
    })
    expect(client.getInvoice).toHaveBeenCalledWith("inv123")
  })

  it("does not authorize a settled overpaid invoice", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(invoice({ additionalStatus: "PaidOver" }))
    const stock = stockRecorder()
    const warnings: string[] = []
    const { service } = await ready(client, {
      stock,
      logger: { warn: (message) => warnings.push(message) },
    })

    await expect(service.authorizePayment({ data: sessionData() })).rejects.toThrow(
      /cannot be authorized/
    )

    expect(warnings).toEqual(["BTCPay confirmation rejected: paid_over"])
    expect(stock.release).not.toHaveBeenCalled()
  })

  it("does not authorize a settled late invoice", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Settled", additionalStatus: "PaidLate" })
    )
    const stock = stockRecorder()
    const warnings: string[] = []
    const { service } = await ready(client, {
      stock,
      logger: { warn: (message) => warnings.push(message) },
    })

    await expect(service.authorizePayment({ data: sessionData() })).rejects.toThrow(
      /cannot be authorized/
    )

    expect(warnings).toEqual(["BTCPay confirmation rejected: paid_late"])
    expect(stock.release).not.toHaveBeenCalled()
  })

  it("does not authorize a settled invoice that is only partially paid", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Settled", additionalStatus: "PaidPartial" })
    )
    const stock = stockRecorder()
    const warnings: string[] = []
    const { service } = await ready(client, {
      stock,
      logger: { warn: (message) => warnings.push(message) },
    })

    await expect(service.authorizePayment({ data: sessionData() })).rejects.toThrow(
      /cannot be authorized/
    )

    expect(warnings).toEqual(["BTCPay confirmation rejected: partial"])
    expect(stock.release).toHaveBeenCalledTimes(1)
  })

  it("does not authorize an expired invoice", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Expired", additionalStatus: "None" })
    )
    const { service } = await ready(client)

    await expect(
      service.authorizePayment({ data: sessionData() })
    ).rejects.toBeInstanceOf(MedusaError)
    const action = await webhook(service, {
      type: "InvoiceExpired",
      invoiceId: "inv123",
      storeId: "store123",
    })

    expect(action.action).toBe(PaymentActions.FAILED)
  })

  it("does not authorize an invalid invoice", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Invalid", additionalStatus: "Invalid" })
    )
    const { service } = await ready(client)

    await expect(
      service.authorizePayment({ data: sessionData() })
    ).rejects.toBeInstanceOf(MedusaError)
    const action = await webhook(service, {
      type: "InvoiceInvalid",
      invoiceId: "inv123",
      storeId: "store123",
    })

    expect(action.action).toBe(PaymentActions.FAILED)
  })

  it("does not authorize an underpaid invoice", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Processing", additionalStatus: "PaidPartial" })
    )
    const { service } = await ready(client)

    await expect(
      service.authorizePayment({ data: sessionData() })
    ).rejects.toThrow(/cannot be authorized/)
    const action = await webhook(service, {
      type: "InvoiceReceivedPayment",
      invoiceId: "inv123",
      storeId: "store123",
    })

    expect(action.action).toBe(PaymentActions.FAILED)
  })

  it("leaves a processing invoice pending and does not complete it from the webhook", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(
      invoice({ status: "Processing", additionalStatus: "None" })
    )
    const { service } = await ready(client)

    const pending = await service.authorizePayment({ data: sessionData() })
    const action = await webhook(service, {
      type: "InvoiceProcessing",
      invoiceId: "inv123",
      storeId: "store123",
    })

    expect(pending.status).toBe("pending")
    expect(action.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("rejects a forged webhook signature before reading the invoice", async () => {
    const client = mockClient()
    const { service, payments } = await ready(client)
    const findByInvoice = jest.spyOn(payments, "findByInvoice")
    const body = {
      type: "InvoiceSettled",
      invoiceId: "inv123",
      storeId: "store123",
    }

    const action = await webhook(service, body, sign(JSON.stringify(body), "other-secret"))

    expect(action.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(client.getInvoice).not.toHaveBeenCalled()
    expect(findByInvoice).not.toHaveBeenCalled()
  })

  it("rejects a replayed webhook confirmation", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(invoice())
    const { service } = await ready(client)
    const body = {
      type: "InvoiceSettled",
      invoiceId: "inv123",
      storeId: "store123",
      deliveryId: "deliv1",
      isRedelivery: true,
    }

    const firstEvent = await webhook(service, body)
    const replayedEvent = await webhook(service, body)
    const first = await service.authorizePayment({ data: sessionData() })

    await expect(
      service.authorizePayment({ data: sessionData() })
    ).rejects.toThrow(/already being confirmed/)

    expect(firstEvent.action).toBe(PaymentActions.AUTHORIZED)
    expect(replayedEvent.action).toBe(PaymentActions.AUTHORIZED)
    expect(first.status).toBe("captured")
  })

  it("lets only one of two concurrent confirmations authorize", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(invoice())
    const { service } = await ready(client)

    const results = await Promise.allSettled([
      service.authorizePayment({ data: sessionData() }),
      service.authorizePayment({ data: sessionData() }),
    ])

    const authorized = results.filter(
      (result) => result.status === "fulfilled" && result.value.status === "captured"
    )
    const rejected = results.filter((result) => result.status === "rejected")

    expect(authorized).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it("does not authorize a settled invoice when the amount does not match the stored row", async () => {
    const client = mockClient()
    const warnings: string[] = []
    const { service } = await ready(client, {
      logger: { warn: (message) => warnings.push(message) },
    })
    client.getInvoice.mockResolvedValue(invoice({ amount: "10.01" }))

    const message = await rejectionOf(service.authorizePayment({ data: sessionData() }))

    expect(message).toBe("BTCPay invoice does not match the stored payment.")
    expect(warnings).toEqual(["BTCPay confirmation rejected: amount_mismatch"])
    expect(secretFree(`${message}\n${warnings.join("\n")}`)).toBe(true)
    const action = await webhook(service, {
      type: "InvoiceSettled",
      invoiceId: "inv123",
      storeId: "store123",
    })
    expect(action.action).toBe(PaymentActions.FAILED)
  })

  it("does not authorize when the invoice store id does not match", async () => {
    const client = mockClient()
    const warnings: string[] = []
    const { service } = await ready(client, {
      logger: { warn: (message) => warnings.push(message) },
    })
    client.getInvoice.mockResolvedValue(invoice({ storeId: "store999" }))

    const message = await rejectionOf(service.authorizePayment({ data: sessionData() }))

    expect(message).toBe("BTCPay invoice does not match the stored payment.")
    expect(warnings).toEqual(["BTCPay confirmation rejected: store_mismatch"])
    expect(secretFree(`${message}\n${warnings.join("\n")}`)).toBe(true)
    expect(message).not.toContain("store999")
    expect(warnings.join(" ")).not.toContain("store999")
  })

  it("does not authorize when the invoice cart id does not match the stored row", async () => {
    const client = mockClient()
    const warnings: string[] = []
    const { service } = await ready(client, {
      logger: { warn: (message) => warnings.push(message) },
    })
    client.getInvoice.mockResolvedValue(
      invoice({
        metadata: {
          orderId: "cart_2",
          cartId: "cart_2",
          paymentSessionId: "payses_1",
          amountCents: 1000,
        },
      })
    )

    const message = await rejectionOf(service.authorizePayment({ data: sessionData() }))

    expect(message).toBe("BTCPay invoice does not match the stored payment.")
    expect(warnings).toEqual(["BTCPay confirmation rejected: cart_mismatch"])
    expect(secretFree(`${message}\n${warnings.join("\n")}`)).toBe(true)
    expect(`${message} ${warnings.join(" ")}`).not.toContain("cart_2")
  })

  it("does not authorize a currency mismatch", async () => {
    const client = mockClient()
    const warnings: string[] = []
    const { service } = await ready(client, {
      logger: { warn: (message) => warnings.push(message) },
    })
    client.getInvoice.mockResolvedValue(invoice({ currency: "EUR" }))

    const message = await rejectionOf(service.authorizePayment({ data: sessionData() }))

    expect(message).toBe("BTCPay invoice does not match the stored payment.")
    expect(warnings).toEqual(["BTCPay confirmation rejected: currency_mismatch"])
    expect(message).not.toContain("EUR")
  })

  it("does not include the API key or webhook secret on error paths", async () => {
    const client = mockClient()
    client.refundInvoice.mockRejectedValue(
      new Error(`refund failed token test-key and ${SECRET}`)
    )
    const warnings: string[] = []
    const { service } = await ready(client, {
      logger: { warn: (message) => warnings.push(message) },
    })

    const message = await rejectionOf(
      service.refundPayment({ data: sessionData(), amount: "4.50" })
    )

    expect(message).toContain("[redacted]")
    expect(secretFree(`${message}\n${warnings.join("\n")}`)).toBe(true)

    const previousWebhookSecret = process.env.BTCPAY_WEBHOOK_SECRET
    process.env.BTCPAY_WEBHOOK_SECRET = SECRET
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(`unauthorized token test-key ${SECRET}`, { status: 401 })
    )
    let httpMessage = ""
    try {
      const http = new BtcpayHttpClient({
        url: ORIGIN,
        storeId: "store123",
        apiKey: "test-key",
      })
      httpMessage = await rejectionOf(http.getInvoice("inv123"))
    } finally {
      fetchMock.mockRestore()
      if (previousWebhookSecret == null) {
        delete process.env.BTCPAY_WEBHOOK_SECRET
      } else {
        process.env.BTCPAY_WEBHOOK_SECRET = previousWebhookSecret
      }
    }

    expect(httpMessage).not.toContain("test-key")
    expect(httpMessage).toContain("[redacted]")
    expect(httpMessage).not.toContain("store123")
  })

  it("maps a database unique violation to a replay", async () => {
    const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    })
    let calls = 0

    const first = await claimOnce(async () => {
      calls += 1
    })
    const second = await claimOnce(async () => {
      throw error
    })

    expect(first).toBe("claimed")
    expect(second).toBe("replay")
    expect(calls).toBe(1)
  })

  it("blocks a second invoice for the same session without reserving stock", async () => {
    const client = mockClient()
    let created = 0
    client.createInvoice.mockImplementation(async () => {
      created += 1
      return invoice({
        id: `inv${created}`,
        checkoutLink: `${ORIGIN}/i/inv${created}`,
        expirationTime: "2099-01-01T00:00:00.000Z",
      })
    })
    const stock = stockRecorder()
    const payments = new MemoryBtcpayPaymentStore()
    const service = provider(client, new MemoryBtcpayClaimStore(), {
      paymentStore: payments,
      stock,
      limits: {
        maxPendingPerCart: 5,
        maxPendingPerSession: 1,
        maxPendingPerCustomer: 5,
      },
    })
    const input = {
      amount: "10.00",
      currency_code: "usd",
      data: {
        cart_id: "cart_1",
        session_id: "payses_1",
        unit_count: 1,
        client_ip: "203.0.113.10",
        redirect_url: "http://localhost:8000/ec/checkout/btcpay/return",
      },
    }

    await service.initiatePayment(input)
    await expect(service.initiatePayment(input)).rejects.toMatchObject({
      code: BTCPAY_PENDING_LIMIT,
      message: PENDING_LIMIT_MESSAGE,
    })

    expect(client.createInvoice).toHaveBeenCalledTimes(1)
    expect(stock.reserve).toHaveBeenCalledTimes(1)
    expect(PENDING_LIMIT_MESSAGE).not.toMatch(/\d/)
  })

  it("blocks a new invoice when the IP window is already full", async () => {
    const client = mockClient()
    let created = 0
    client.createInvoice.mockImplementation(async () => {
      created += 1
      return invoice({
        id: `inv${created}`,
        checkoutLink: `${ORIGIN}/i/inv${created}`,
      })
    })
    const stock = stockRecorder()
    const payments = new MemoryBtcpayPaymentStore()
    const service = provider(client, new MemoryBtcpayClaimStore(), {
      paymentStore: payments,
      stock,
      limits: {
        maxPendingPerCart: 5,
        maxPendingPerSession: 5,
        maxPendingPerCustomer: 5,
        maxNewInvoicesPerIp: 2,
      },
    })

    for (const id of ["a", "b"]) {
      await service.initiatePayment({
        amount: "10.00",
        currency_code: "usd",
        data: {
          cart_id: `cart_${id}`,
          session_id: `payses_${id}`,
          unit_count: 1,
          client_ip: "203.0.113.20",
          redirect_url: "http://localhost:8000/ec/checkout/btcpay/return",
        },
      })
    }

    await expect(
      service.initiatePayment({
        amount: "10.00",
        currency_code: "usd",
        data: {
          cart_id: "cart_c",
          session_id: "payses_c",
          unit_count: 1,
          client_ip: "203.0.113.20",
          redirect_url: "http://localhost:8000/ec/checkout/btcpay/return",
        },
      })
    ).rejects.toMatchObject({ code: BTCPAY_PENDING_LIMIT })

    expect(client.createInvoice).toHaveBeenCalledTimes(2)
    expect(stock.reserve).toHaveBeenCalledTimes(2)
  })

  it("blocks a pending order over the unit cap without reserving stock", async () => {
    const client = mockClient()
    client.createInvoice.mockResolvedValue(invoice())
    const stock = stockRecorder()
    const service = provider(client, new MemoryBtcpayClaimStore(), {
      paymentStore: new MemoryBtcpayPaymentStore(),
      stock,
      limits: { maxUnitsPerPendingOrder: 2 },
    })

    await expect(
      service.initiatePayment({
        amount: "30.00",
        currency_code: "usd",
        data: {
          cart_id: "cart_big",
          session_id: "payses_big",
          unit_count: 3,
          client_ip: "203.0.113.30",
          redirect_url: "http://localhost:8000/ec/checkout/btcpay/return",
        },
      })
    ).rejects.toMatchObject({
      code: BTCPAY_PENDING_LIMIT,
      message: PENDING_LIMIT_MESSAGE,
    })

    expect(client.createInvoice).not.toHaveBeenCalled()
    expect(stock.reserve).not.toHaveBeenCalled()
  })

  it("refuses to cancel a settled invoice and explains the pull-payment refund", async () => {
    const client = mockClient()
    client.getInvoice.mockResolvedValue(invoice())
    client.refundInvoice.mockResolvedValue({
      id: "pull1",
      viewLink: `${ORIGIN}/pull-payments/pull1`,
    })
    const service = provider(client)

    await expect(service.cancelPayment({ data: sessionData() })).rejects.toThrow(
      /cannot be canceled/
    )

    const refund = await service.refundPayment({
      data: sessionData(),
      amount: "4.50",
    })

    expect(client.refundInvoice).toHaveBeenCalledWith("inv123", {
      customAmount: "4.50",
      customCurrency: "USD",
    })
    expect(refund.data).toEqual(
      expect.objectContaining({ refund_view_link: `${ORIGIN}/pull-payments/pull1` })
    )
  })
})

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("expected the call to fail")
}

function secretFree(text: string): boolean {
  return (
    !text.includes("test-key") &&
    !text.includes(SECRET) &&
    !text.includes("10.01") &&
    !text.includes("1001") &&
    !text.includes("cart_1") &&
    !text.includes("store123")
  )
}

function stockRecorder(): StockReserver {
  return {
    reserve: jest.fn(async () => ["res_1"]),
    release: jest.fn(async () => undefined),
  }
}

function mockClient(): jest.Mocked<BtcpayClient> {
  return {
    createInvoice: jest.fn(),
    getInvoice: jest.fn(),
    markInvoiceInvalid: jest.fn(),
    refundInvoice: jest.fn(),
  }
}
