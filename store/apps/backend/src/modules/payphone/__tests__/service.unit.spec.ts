import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { PAYPHONE_API_BASE } from "../client"
import PayphoneProviderService, {
  PayphoneResultCode,
  classifyPayphoneMessage,
} from "../service"

const SESSION = "payses_01TESTSESSION"
const PREPARE = `${PAYPHONE_API_BASE}/api/button/Prepare`
const CONFIRM = `${PAYPHONE_API_BASE}/api/button/V2/Confirm`
const REVERSE = `${PAYPHONE_API_BASE}/api/Reverse`
const CARD_URL =
  "https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=abc"
const APP_URL =
  "https://pay.payphonetodoesposible.com/PayPhone/Index?paymentId=abc"

type FetchCall = {
  url: string
  body: Record<string, unknown>
  authorization: string
}

function createHarness(
  responder: (call: FetchCall) => { status?: number; body: unknown }
) {
  const calls: FetchCall[] = []
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>
    const call: FetchCall = {
      url,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      authorization: headers.Authorization,
    }
    calls.push(call)
    const result = responder(call)

    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      text: async () =>
        typeof result.body === "string" ? result.body : JSON.stringify(result.body),
    }
  })

  const service = new PayphoneProviderService(
    { logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as never },
    {
      token: "test-token",
      storeId: "store-1",
      responseUrl: "https://shop.example/api/payphone/return",
      cancellationUrl:
        "https://shop.example/ec/checkout?step=payment&payphone=cancelled",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }
  )

  return { service, calls }
}

function approved(overrides: Record<string, unknown> = {}) {
  return {
    email: "buyer@example.com",
    amount: 1150,
    clientTransactionId: SESSION,
    statusCode: 3,
    transactionStatus: "Approved",
    authorizationCode: "W23178284",
    message: null,
    messageCode: 0,
    transactionId: 23178284,
    currency: "USD",
    date: "2026-10-03T11:57:26.367",
    cardBrand: "Visa",
    lastDigits: "XX17",
    document: "1234567890",
    phoneNumber: "593999999999",
    ...overrides,
  }
}

function authorizeInput(data: Record<string, unknown> = {}) {
  return {
    data: {
      session_id: SESSION,
      amount_cents: 1150,
      payphone_transaction_id: 23178284,
      ...data,
    },
    context: { idempotency_key: SESSION },
  }
}

describe("PayphoneProviderService", () => {
  it("prepares a tax-inclusive charge in cents", async () => {
    const { service, calls } = createHarness(() => ({
      body: {
        paymentId: "abc",
        payWithCard: CARD_URL,
        payWithPayPhone: APP_URL,
      },
    }))

    const result = await service.initiatePayment({
      amount: 11.5,
      currency_code: "usd",
      data: { session_id: SESSION },
      context: { idempotency_key: SESSION },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(PREPARE)
    expect(calls[0].authorization).toBe("Bearer test-token")
    expect(calls[0].body).toMatchObject({
      amount: 1150,
      amountWithoutTax: 0,
      amountWithTax: 1000,
      tax: 150,
      service: 0,
      tip: 0,
      clientTransactionId: SESSION,
      currency: "USD",
      storeId: "store-1",
      responseUrl: "https://shop.example/api/payphone/return",
      cancellationUrl:
        "https://shop.example/ec/checkout?step=payment&payphone=cancelled",
    })
    expect(calls[0].body).not.toHaveProperty("token")
    expect(result.data).toMatchObject({
      pay_with_card: CARD_URL,
      pay_with_payphone: APP_URL,
      amount_cents: 1150,
      tax_cents: 150,
      client_transaction_id: SESSION,
    })
    expect(JSON.stringify(result.data)).not.toContain("test-token")
  })

  it("rejects a payment link that is not PayPhone's https host", async () => {
    const { service } = createHarness(() => ({
      body: {
        paymentId: "abc",
        payWithCard: "https://user:pass@pay.payphonetodoesposible.com:444/pay",
        payWithPayPhone: APP_URL,
      },
    }))

    await expect(
      service.initiatePayment({
        amount: 11.5,
        currency_code: "usd",
        data: { session_id: SESSION },
        context: { idempotency_key: SESSION },
      })
    ).rejects.toThrow("No pudimos iniciar el pago con PayPhone.")
  })

  it("authorizes only after PayPhone confirms an approved matching charge", async () => {
    const { service, calls } = createHarness(() => ({ body: approved() }))

    const result = await service.authorizePayment(
      authorizeInput({ client_transaction_id: "tampered" })
    )

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({
      transaction_id: 23178284,
      transaction_status: "Approved",
      amount_cents: 1150,
      client_transaction_id: SESSION,
    })
    expect(result.data).not.toHaveProperty("document")
    expect(result.data).not.toHaveProperty("email")
    expect(calls[0].url).toBe(CONFIRM)
    expect(calls[0].body).toEqual({ id: 23178284, clientTxId: SESSION })
  })

  it("does not authorize a declined transaction", async () => {
    const { service, calls } = createHarness(() => ({
      body: approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: "Transacción rechazada",
        authorizationCode: null,
      }),
    }))

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.declined
    )
    expect(calls.map((call) => call.url)).toEqual([CONFIRM])
    expect(classifyPayphoneMessage(PayphoneResultCode.declined)).toBe("declined")
  })

  it("does not authorize a cancelled transaction", async () => {
    const { service, calls } = createHarness(() => ({
      body: approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: null,
        authorizationCode: null,
      }),
    }))

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.cancelled
    )
    expect(calls.map((call) => call.url)).toEqual([CONFIRM])
  })

  it("reverses an approved transaction whose amount does not match", async () => {
    const { service, calls } = createHarness((call) => {
      if (call.url === REVERSE) {
        return { body: true }
      }

      return { body: approved({ amount: 100 }) }
    })

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.mismatch
    )
    expect(calls.map((call) => call.url)).toEqual([CONFIRM, REVERSE])
    expect(calls[1].body).toEqual({ id: 23178284 })
  })

  it("returns the same captured result when confirm is repeated", async () => {
    const { service, calls } = createHarness(() => ({ body: approved() }))
    const input = authorizeInput()

    const first = await service.authorizePayment(input)
    const second = await service.authorizePayment(input)

    expect(first.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(second.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(second.data?.transaction_id).toBe(first.data?.transaction_id)
    expect(calls.map((call) => call.url)).toEqual([CONFIRM, CONFIRM])
  })

  it("re-confirms a notification instead of trusting the posted amount", async () => {
    const { service, calls } = createHarness(() => ({ body: approved() }))

    const result = await service.getWebhookActionAndData({
      data: {
        Amount: 1,
        ClientTransactionId: SESSION,
        TransactionId: 23178284,
        StoreId: "store-1",
        StatusCode: 3,
        TransactionStatus: "Approved",
      },
      rawData: "{}",
      headers: {},
    })

    expect(calls[0].url).toBe(CONFIRM)
    expect(calls[0].body).toEqual({ id: 23178284, clientTxId: SESSION })
    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe(SESSION)
    expect(Number(result.data?.amount)).toBe(11.5)
  })

  it("ignores a notification for another store without calling PayPhone", async () => {
    const { service, calls } = createHarness(() => ({ body: approved() }))

    const result = await service.getWebhookActionAndData({
      data: {
        ClientTransactionId: SESSION,
        TransactionId: 23178284,
        StoreId: "someone-else",
      },
      rawData: "{}",
      headers: {},
    })

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(result.data?.session_id).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it("does not mark a declined notification as captured", async () => {
    const { service } = createHarness(() => ({
      body: approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: "Transacción rechazada",
      }),
    }))

    const result = await service.getWebhookActionAndData({
      data: {
        ClientTransactionId: SESSION,
        TransactionId: 23178284,
        StoreId: "store-1",
        TransactionStatus: "Approved",
        Amount: 1150,
      },
      rawData: "{}",
      headers: {},
    })

    expect(result.action).toBe(PaymentActions.FAILED)
    expect(result.data?.session_id).toBeUndefined()
  })
})
