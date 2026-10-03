import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { planPayphoneCompletion } from "../completion"
import type { PayphoneHttpClient } from "../client"
import { PAYPHONE_PROVIDER_ID, SYSTEM_PROVIDER_ID } from "../providers"
import PayphoneProviderService, { PayphoneResultCode } from "../service"

const SESSION = "payses_01TESTSESSION"
const CARD_URL =
  "https://pay.payphonetodoesposible.com/Anonymous/Index?paymentId=abc"
const APP_URL =
  "https://pay.payphonetodoesposible.com/PayPhone/Index?paymentId=abc"

function pendingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    amount: 11.5,
    currency_code: "usd",
    provider_id: PAYPHONE_PROVIDER_ID,
    payment_collection_id: "pay_col_1",
    data: {
      session_id: SESSION,
      client_transaction_id: SESSION,
      amount_cents: 1150,
      payphone_confirmed: false,
      transaction_status: "Pending",
      pay_with_card: CARD_URL,
      pay_with_payphone: APP_URL,
      ...overrides,
    },
  }
}

describe("planPayphoneCompletion", () => {
  it("rejects a forged client transaction id that is not a PayPhone session", () => {
    const plan = planPayphoneCompletion({
      session: undefined,
      cartId: null,
      existingOrderId: null,
      payphoneTransactionId: 23178284,
    })

    expect(plan).toEqual({ action: "reject" })
  })

  it("rejects a forged callback aimed at the manual test provider", () => {
    const plan = planPayphoneCompletion({
      session: {
        ...pendingSession(),
        provider_id: SYSTEM_PROVIDER_ID,
      },
      cartId: "cart_1",
      existingOrderId: null,
      payphoneTransactionId: 23178284,
    })

    expect(plan).toEqual({ action: "reject" })
  })

  it("replays an existing order without a second confirm", async () => {
    const confirm = jest.fn()
    const plan = planPayphoneCompletion({
      session: pendingSession({
        payphone_confirmed: true,
        transaction_status: "Approved",
        transaction_id: 23178284,
      }),
      cartId: "cart_1",
      existingOrderId: "order_01",
      payphoneTransactionId: 23178284,
    })

    expect(plan).toEqual({
      action: "return_order",
      orderId: "order_01",
      cartId: "cart_1",
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it("asks for a server confirm before a new order, and does not capture a decline", async () => {
    const confirm = jest.fn(async () => ({
      amount: 1150,
      clientTransactionId: SESSION,
      statusCode: 2,
      transactionStatus: "Canceled",
      message: "Transacción rechazada",
      transactionId: 999,
      currency: "USD",
    }))
    const client: PayphoneHttpClient = {
      prepare: async () => ({
        paymentId: "abc",
        payWithCard: CARD_URL,
        payWithPayPhone: APP_URL,
      }),
      confirm,
      reverse: async () => undefined,
    }
    const service = new PayphoneProviderService(
      { logger: { error: jest.fn() } as never },
      { client, storeId: "store-1" }
    )
    const plan = planPayphoneCompletion({
      session: pendingSession(),
      cartId: "cart_1",
      existingOrderId: null,
      payphoneTransactionId: 999,
    })

    expect(plan.action).toBe("confirm_and_complete")
    if (plan.action !== "confirm_and_complete") {
      return
    }

    await expect(
      service.authorizePayment({
        data: {
          ...plan.data,
          payphone_transaction_id: plan.payphoneTransactionId,
        },
        context: { idempotency_key: plan.sessionId },
      })
    ).rejects.toThrow(PayphoneResultCode.declined)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(999, SESSION)
  })

  it("marks the session captured only after Confirm approves the same client and amount", async () => {
    const confirm = jest.fn(async () => ({
      amount: 1150,
      clientTransactionId: SESSION,
      statusCode: 3,
      transactionStatus: "Approved",
      authorizationCode: "W1",
      transactionId: 23178284,
      currency: "USD",
    }))
    const client: PayphoneHttpClient = {
      prepare: async () => ({
        paymentId: "abc",
        payWithCard: CARD_URL,
        payWithPayPhone: APP_URL,
      }),
      confirm,
      reverse: async () => undefined,
    }
    const service = new PayphoneProviderService(
      { logger: { error: jest.fn() } as never },
      { client, storeId: "store-1" }
    )
    const plan = planPayphoneCompletion({
      session: pendingSession(),
      cartId: "cart_1",
      existingOrderId: null,
      payphoneTransactionId: 23178284,
    })

    if (plan.action !== "confirm_and_complete") {
      throw new Error("expected a confirm")
    }

    const authorized = await service.authorizePayment({
      data: {
        ...plan.data,
        payphone_transaction_id: plan.payphoneTransactionId,
      },
      context: { idempotency_key: plan.sessionId },
    })

    expect(authorized.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(confirm).toHaveBeenCalledTimes(1)

    await service.authorizePayment({
      data: authorized.data,
      context: { idempotency_key: plan.sessionId },
    })
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
