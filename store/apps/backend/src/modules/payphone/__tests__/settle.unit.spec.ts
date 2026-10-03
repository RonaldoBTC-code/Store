import { PayphoneResultCode } from "../service"
import { settlePayphonePayment, type PayphoneClaimStore } from "../settle"
import type { PayphoneHttpClient, PayphoneTransaction } from "../client"

const SESSION = "payses_01SETTLE"
const CART = "cart_01SETTLE"

function approved(overrides: Partial<PayphoneTransaction> = {}): PayphoneTransaction {
  return {
    amount: 3500,
    clientTransactionId: SESSION,
    statusCode: 3,
    transactionStatus: "Approved",
    transactionId: 42,
    currency: "USD",
    ...overrides,
  }
}

function memoryClaims(): PayphoneClaimStore & {
  rows: Map<string, { status: string; orderId?: string }>
} {
  const rows = new Map<string, { status: string; orderId?: string }>()

  return {
    rows,
    async insertPending(input) {
      if (rows.has(input.clientTransactionId)) {
        return "duplicate"
      }

      rows.set(input.clientTransactionId, { status: "pending" })
      return "claimed"
    },
    async markCaptured(clientTransactionId, _transactionId, orderId) {
      const row = rows.get(clientTransactionId)
      if (!row) {
        return
      }

      row.status = "captured"
      row.orderId = orderId
    },
    async markRejected(clientTransactionId) {
      const row = rows.get(clientTransactionId)
      if (!row) {
        return
      }

      row.status = "rejected"
    },
  }
}

function harness(options: {
  cartTotal?: string
  cartCurrency?: string
  payphone?: PayphoneTransaction | null
  requestCartId?: string | null
  initiatedAmountCents?: number
} = {}) {
  const claims = memoryClaims()
  const confirmCalls: unknown[] = []
  const reverseCalls: number[] = []
  let completes = 0
  const client: PayphoneHttpClient = {
    prepare: async () => {
      throw new Error("prepare is not part of settle")
    },
    confirm: async () => {
      confirmCalls.push(true)
      return options.payphone === undefined ? approved() : options.payphone!
    },
    reverse: async (transactionId) => {
      reverseCalls.push(transactionId)
    },
  }

  const run = () =>
    settlePayphonePayment(
      {
        claims,
        client,
        loadCart: async () => ({
          id: CART,
          currencyCode: options.cartCurrency ?? "usd",
          total: options.cartTotal ?? "35.00",
          taxTotal: "4.57",
          shippingTotal: 0,
          shippingTaxTotal: 0,
        }),
        complete: async () => {
          completes += 1
          return { orderId: "order_01SETTLE" }
        },
      },
      {
        sessionCartId: CART,
        requestCartId: options.requestCartId,
        sessionId: SESSION,
        currencyCode: "usd",
        initiatedAmountCents: options.initiatedAmountCents ?? 3500,
        payphoneTransactionId: 42,
        sessionData: {
          session_id: SESSION,
          amount_cents: options.initiatedAmountCents ?? 3500,
          payphone_confirmed: false,
        },
      }
    )

  return { run, claims, confirmCalls, reverseCalls, completes: () => completes }
}

describe("settlePayphonePayment", () => {
  it("completes once when PayPhone matches the cart", async () => {
    const { run, confirmCalls, completes, claims } = harness()

    const result = await run()

    expect(result).toEqual({ orderId: "order_01SETTLE", transactionId: 42 })
    expect(confirmCalls).toHaveLength(1)
    expect(completes()).toBe(1)
    expect(claims.rows.get(SESSION)?.status).toBe("captured")
  })

  it("does not complete when PayPhone's amount is 1 cent below the cart", async () => {
    const { run, confirmCalls, reverseCalls, completes, claims } = harness({
      payphone: approved({ amount: 3499 }),
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.amount)
    expect(confirmCalls).toHaveLength(1)
    expect(reverseCalls).toEqual([42])
    expect(completes()).toBe(0)
    expect(claims.rows.get(SESSION)?.status).toBe("rejected")
  })

  it("does not complete when PayPhone's currency is not USD", async () => {
    const { run, confirmCalls, reverseCalls, completes } = harness({
      payphone: approved({ currency: "EUR" }),
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.currency)
    expect(confirmCalls).toHaveLength(1)
    expect(reverseCalls).toEqual([42])
    expect(completes()).toBe(0)
  })

  it("does not confirm when the client transaction belongs to another cart", async () => {
    const { run, confirmCalls, completes, claims } = harness({
      requestCartId: "cart_OTHER",
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.client)
    expect(confirmCalls).toHaveLength(0)
    expect(completes()).toBe(0)
    expect(claims.rows.size).toBe(0)
  })

  it("does not confirm when the cart total changed after payment started", async () => {
    const { run, confirmCalls, completes, claims } = harness({
      cartTotal: "36.00",
      initiatedAmountCents: 3500,
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.cartChanged)
    expect(confirmCalls).toHaveLength(0)
    expect(completes()).toBe(0)
    expect(claims.rows.size).toBe(0)
  })
})
