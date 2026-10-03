import { MedusaError, PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import type { PayphoneHttpClient, PayphoneTransaction } from "../client"
import PayphoneProviderService, {
  PayphoneResultCode,
  classifyPayphoneMessage,
} from "../service"

const SESSION = "payses_01TESTSESSION"
const CARD_URL =
  "https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=abc"
const APP_URL =
  "https://pay.payphonetodoesposible.com/PayPhone/Index?paymentId=abc"

type ConfirmCall = { id: number; clientTxId: string }

function approved(overrides: Partial<PayphoneTransaction> = {}): PayphoneTransaction {
  return {
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
    ...overrides,
  }
}

function mockClient(
  confirmResult: (call: ConfirmCall) => PayphoneTransaction | Promise<PayphoneTransaction> = () =>
    approved()
) {
  const prepareCalls: unknown[] = []
  const confirmCalls: ConfirmCall[] = []
  const reverseCalls: number[] = []
  const client: PayphoneHttpClient = {
    prepare: async (input) => {
      prepareCalls.push(input)
      return {
        paymentId: "abc",
        payWithCard: CARD_URL,
        payWithPayPhone: APP_URL,
      }
    },
    confirm: async (id, clientTxId) => {
      const call = { id, clientTxId }
      confirmCalls.push(call)
      return confirmResult(call)
    },
    reverse: async (transactionId) => {
      reverseCalls.push(transactionId)
    },
  }

  const service = new PayphoneProviderService(
    { logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as never },
    { client, storeId: "store-1" }
  )

  return { service, client, prepareCalls, confirmCalls, reverseCalls }
}

function authorizeInput(data: Record<string, unknown> = {}) {
  return {
    data: {
      session_id: SESSION,
      client_transaction_id: SESSION,
      amount_cents: 1150,
      payphone_transaction_id: 23178284,
      payphone_confirmed: false,
      transaction_status: "Pending",
      pay_with_card: CARD_URL,
      pay_with_payphone: APP_URL,
      payment_id: "abc",
      ...data,
    },
    context: { idempotency_key: SESSION },
  }
}

describe("PayphoneProviderService", () => {
  it("prepares a tax-inclusive charge in cents without a PayPhone token", async () => {
    const { service, prepareCalls } = mockClient()

    const forged = {
      session_id: SESSION,
      payphone_confirmed: true,
      transaction_status: "Approved",
      transaction_id: 1,
      amount_cents: 1,
    }
    const result = await service.initiatePayment({
      amount: 11.5,
      currency_code: "usd",
      data: forged,
      context: { idempotency_key: SESSION },
    })

    expect(prepareCalls).toEqual([
      {
        clientTransactionId: SESSION,
        split: {
          amount: 1150,
          amountWithoutTax: 0,
          amountWithTax: 1000,
          tax: 150,
          service: 0,
          tip: 0,
        },
      },
    ])
    const stored = { ...forged, ...result.data }
    expect(stored).toMatchObject({
      pay_with_card: CARD_URL,
      amount_cents: 1150,
      tax_cents: 150,
      client_transaction_id: SESSION,
      payphone_confirmed: false,
      transaction_status: "Pending",
      transaction_id: null,
    })
    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(JSON.stringify(result.data)).not.toContain("test-token")
    expect(JSON.stringify(stored)).not.toMatch(/Bearer|PAYPHONE_TOKEN/)
  })

  it("rejects a payment link that is not PayPhone's https host", async () => {
    const prepareCalls: unknown[] = []
    const client: PayphoneHttpClient = {
      prepare: async (input) => {
        prepareCalls.push(input)
        return {
          paymentId: "abc",
          payWithCard: "https://user:pass@pay.payphonetodoesposible.com:444/pay",
          payWithPayPhone: APP_URL,
        }
      },
      confirm: async () => approved(),
      reverse: async () => undefined,
    }
    const service = new PayphoneProviderService(
      { logger: { error: jest.fn() } as never },
      { client, storeId: "store-1" }
    )

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
    const { service, confirmCalls, reverseCalls } = mockClient()

    const result = await service.authorizePayment(
      authorizeInput({ client_transaction_id: "tampered" })
    )

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({
      transaction_id: 23178284,
      transaction_status: "Approved",
      amount_cents: 1150,
      client_transaction_id: SESSION,
      payphone_confirmed: true,
    })
    expect(result.data).not.toHaveProperty("document")
    expect(result.data).not.toHaveProperty("email")
    expect(confirmCalls).toEqual([{ id: 23178284, clientTxId: SESSION }])
    expect(reverseCalls).toHaveLength(0)
    expect(classifyPayphoneMessage(`${PayphoneResultCode.declined}:x`)).toBe(
      "declined"
    )
  })

  it("does not capture a forged redirect when PayPhone declines it", async () => {
    const { service, confirmCalls, reverseCalls } = mockClient(() =>
      approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: "Transacción rechazada",
        authorizationCode: null,
      })
    )

    await expect(
      service.authorizePayment(
        authorizeInput({
          payphone_transaction_id: 999,
          transaction_status: "Approved",
          transaction_id: 999,
        })
      )
    ).rejects.toThrow(PayphoneResultCode.declined)
    expect(confirmCalls).toEqual([{ id: 999, clientTxId: SESSION }])
    expect(reverseCalls).toHaveLength(0)
  })

  it("does not authorize a cancelled transaction", async () => {
    const { service, confirmCalls } = mockClient(() =>
      approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: null,
        authorizationCode: null,
      })
    )

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.cancelled
    )
    expect(confirmCalls).toHaveLength(1)
  })

  it("reverses an approved transaction whose client id was forged", async () => {
    const { service, confirmCalls, reverseCalls } = mockClient(() =>
      approved({ clientTransactionId: "payses_ATTACKER" })
    )

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.mismatch
    )
    expect(confirmCalls).toEqual([{ id: 23178284, clientTxId: SESSION }])
    expect(reverseCalls).toEqual([23178284])
  })

  it("reverses an approved transaction whose amount does not match", async () => {
    const { service, reverseCalls } = mockClient(() => approved({ amount: 100 }))

    await expect(service.authorizePayment(authorizeInput())).rejects.toThrow(
      PayphoneResultCode.mismatch
    )
    expect(reverseCalls).toEqual([23178284])
  })

  it("does not confirm a replay of an already confirmed session", async () => {
    const { service, confirmCalls, reverseCalls } = mockClient()
    const input = authorizeInput()

    const first = await service.authorizePayment(input)
    const replayed = await service.updatePayment({
      amount: 11.5,
      currency_code: "usd",
      data: {
        ...(first.data ?? {}),
        payphone_transaction_id: 23178284,
      },
      context: { idempotency_key: SESSION },
    })
    const second = await service.authorizePayment({
      data: replayed.data,
      context: { idempotency_key: SESSION },
    })

    expect(first.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(second.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(second.data?.transaction_id).toBe(23178284)
    expect(confirmCalls).toEqual([{ id: 23178284, clientTxId: SESSION }])
    expect(reverseCalls).toHaveLength(0)
  })

  it("drops a forged paid flag when the session is updated before confirm", async () => {
    const { service, confirmCalls } = mockClient(() =>
      approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: null,
      })
    )
    const initiated = await service.initiatePayment({
      amount: 11.5,
      currency_code: "usd",
      data: {
        session_id: SESSION,
        payphone_confirmed: true,
        transaction_status: "Approved",
        transaction_id: 23178284,
        amount_cents: 1150,
      },
      context: { idempotency_key: SESSION },
    })
    const updated = await service.updatePayment({
      amount: 11.5,
      currency_code: "usd",
      data: {
        ...(initiated.data ?? {}),
        payphone_confirmed: true,
        transaction_status: "Approved",
        transaction_id: 23178284,
        payphone_transaction_id: 23178284,
        amount_cents: 1,
      },
      context: { idempotency_key: SESSION },
    })

    expect(updated.data?.payphone_confirmed).toBe(false)
    expect(updated.data?.transaction_status).toBe("Pending")
    await expect(
      service.authorizePayment({
        data: {
          ...(updated.data ?? {}),
          payphone_transaction_id: 23178284,
        },
        context: { idempotency_key: SESSION },
      })
    ).rejects.toThrow(PayphoneResultCode.cancelled)
    expect(confirmCalls).toHaveLength(1)
  })

  it("does not capture from a forged approved status without a confirm", async () => {
    const { service } = mockClient()

    await expect(
      service.capturePayment({
        data: {
          transaction_status: "Approved",
          transaction_id: 23178284,
          payphone_confirmed: false,
        },
      })
    ).rejects.toBeInstanceOf(MedusaError)
  })

  it("re-confirms a notification instead of trusting the posted amount", async () => {
    const { service, confirmCalls } = mockClient()

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

    expect(confirmCalls).toEqual([{ id: 23178284, clientTxId: SESSION }])
    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe(SESSION)
    expect(Number(result.data?.amount)).toBe(11.5)
  })

  it("does not mark a forged approved notification as paid", async () => {
    const { service, confirmCalls } = mockClient(() =>
      approved({
        statusCode: 2,
        transactionStatus: "Canceled",
        message: "Transacción rechazada",
      })
    )

    const result = await service.getWebhookActionAndData({
      data: {
        ClientTransactionId: SESSION,
        TransactionId: 23178284,
        StoreId: "store-1",
        TransactionStatus: "Approved",
        StatusCode: 3,
        Amount: 1150,
      },
      rawData: "{}",
      headers: {},
    })

    expect(confirmCalls).toHaveLength(1)
    expect(result.action).toBe(PaymentActions.FAILED)
    expect(result.data?.session_id).toBeUndefined()
  })

  it("ignores a notification for another store without calling PayPhone", async () => {
    const { service, confirmCalls } = mockClient()

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
    expect(confirmCalls).toHaveLength(0)
  })
})
