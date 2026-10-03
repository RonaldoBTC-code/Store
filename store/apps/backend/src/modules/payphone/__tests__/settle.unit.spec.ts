import { MedusaError } from "@medusajs/framework/utils"
import { retryPayphoneReversals } from "../../../jobs/payphone-reverse"
import type { PayphoneClaimRecord } from "../../payphone-claim/service"
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
  rows: Map<string, PayphoneClaimRecord>
  byClient: Map<string, string>
} {
  const rows = new Map<string, PayphoneClaimRecord>()
  const byClient = new Map<string, string>()
  let seq = 0

  const findClient = (clientTransactionId: string) => {
    const id = byClient.get(clientTransactionId)
    return id ? rows.get(id) ?? null : null
  }

  return {
    rows,
    byClient,
    async ensurePending(input) {
      const existing = findClient(input.clientTransactionId)
      if (existing) {
        return existing
      }

      seq += 1
      const row: PayphoneClaimRecord = {
        id: `claim_${seq}`,
        clientTransactionId: input.clientTransactionId,
        transactionId: null,
        cartId: input.cartId,
        status: "pending",
        orderId: null,
      }
      rows.set(row.id, row)
      byClient.set(row.clientTransactionId, row.id)
      return row
    },
    async claimProcessing(id) {
      const row = rows.get(id)
      if (!row || row.status !== "pending") {
        return null
      }

      row.status = "processing"
      return { ...row }
    },
    async attachTransactionId(id, transactionId) {
      for (const row of rows.values()) {
        if (row.transactionId === transactionId && row.id !== id) {
          return "duplicate"
        }
      }

      const row = rows.get(id)
      if (!row || row.status !== "processing") {
        return "duplicate"
      }

      row.transactionId = transactionId
      return "attached"
    },
    async markNeedsReversal(id, transactionId) {
      const row = rows.get(id)
      if (!row) {
        return
      }

      row.status = "needs_reversal"
      row.transactionId = transactionId
    },
    async markReversed(id) {
      const row = rows.get(id)
      if (!row) {
        return
      }

      row.status = "reversed"
    },
    async markRejected(id) {
      const row = rows.get(id)
      if (!row) {
        return
      }

      row.status = "rejected"
    },
    async markCaptured(clientTransactionId, transactionId, orderId) {
      const row = findClient(clientTransactionId)
      if (!row) {
        return
      }

      row.status = "captured"
      row.transactionId = transactionId
      row.orderId = orderId
    },
    async getByTransactionId(transactionId) {
      for (const row of rows.values()) {
        if (row.transactionId === transactionId) {
          return { ...row }
        }
      }

      return null
    },
    async getByClientTransactionId(clientTransactionId) {
      const row = findClient(clientTransactionId)
      return row ? { ...row } : null
    },
  }
}

function harness(options: {
  cartTotal?: string
  cartCurrency?: string
  payphone?: PayphoneTransaction | null
  requestCartId?: string | null
  initiatedAmountCents?: number
  complete?: () => Promise<{ orderId: string }>
  reverse?: (transactionId: number) => Promise<void>
  completeTimeoutMs?: number
} = {}) {
  const claims = memoryClaims()
  const confirmCalls: unknown[] = []
  const reverseCalls: number[] = []
  let completes = 0
  let completeAttempts = 0
  const client: PayphoneHttpClient = {
    prepare: async () => {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "prepare is not part of settle"
      )
    },
    confirm: async () => {
      confirmCalls.push(true)
      return options.payphone === undefined ? approved() : options.payphone!
    },
    reverse: async (transactionId) => {
      reverseCalls.push(transactionId)
      if (options.reverse) {
        await options.reverse(transactionId)
      }
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
          completeAttempts += 1
          if (options.complete) {
            return options.complete()
          }

          completes += 1
          return { orderId: "order_01SETTLE" }
        },
        completeTimeoutMs: options.completeTimeoutMs,
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

  return {
    run,
    claims,
    confirmCalls,
    reverseCalls,
    completes: () => completes,
    completeAttempts: () => completeAttempts,
  }
}

function statusOf(claims: ReturnType<typeof memoryClaims>) {
  return claims.rows.values().next().value?.status
}

describe("settlePayphonePayment", () => {
  it("completes once when PayPhone matches the cart", async () => {
    const { run, confirmCalls, completes, claims } = harness()

    const result = await run()

    expect(result).toEqual({ orderId: "order_01SETTLE", transactionId: 42 })
    expect(confirmCalls).toHaveLength(1)
    expect(completes()).toBe(1)
    expect(statusOf(claims)).toBe("captured")
  })

  it("does not complete when PayPhone's amount is 1 cent below the cart", async () => {
    const { run, confirmCalls, reverseCalls, completes, claims } = harness({
      payphone: approved({ amount: 3499 }),
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.amount)
    expect(confirmCalls).toHaveLength(1)
    expect(reverseCalls).toEqual([42])
    expect(completes()).toBe(0)
    expect(statusOf(claims)).toBe("reversed")
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

  it("reverses an approved confirm when the cart completion hook rejects", async () => {
    const { run, confirmCalls, reverseCalls, completes, completeAttempts, claims } =
      harness({
        complete: async () => {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "La cédula o el RUC no es válido."
          )
        },
      })

    await expect(run()).rejects.toThrow(PayphoneResultCode.failed)
    expect(confirmCalls).toHaveLength(1)
    expect(completeAttempts()).toBe(1)
    expect(reverseCalls).toEqual([42])
    expect(completes()).toBe(0)
    expect(statusOf(claims)).toBe("reversed")
  })

  it("leaves needs_reversal when order creation fails and reverse fails", async () => {
    const { run, confirmCalls, reverseCalls, claims } = harness({
      complete: async () => {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "order failed"
        )
      },
      reverse: async () => {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "reverse down")
      },
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.failed)
    expect(confirmCalls).toHaveLength(1)
    expect(reverseCalls).toEqual([42])
    expect(statusOf(claims)).toBe("needs_reversal")

    let jobReverses = 0
    await retryPayphoneReversals({
      graceSeconds: 0,
      listWork: async () =>
        [...claims.rows.values()].filter((row) => row.status === "needs_reversal"),
      claimReversal: async (id) => {
        const row = claims.rows.get(id)
        if (!row || row.status !== "needs_reversal") {
          return null
        }

        row.status = "reversing"
        return { ...row }
      },
      markReversed: async (id) => {
        const row = claims.rows.get(id)
        if (row) {
          row.status = "reversed"
        }
      },
      releaseReversal: async (id) => {
        const row = claims.rows.get(id)
        if (row && row.status === "reversing") {
          row.status = "needs_reversal"
        }
      },
      markCaptured: async () => undefined,
      findOrderId: async () => null,
      reverse: async () => {
        jobReverses += 1
      },
    })

    expect(jobReverses).toBe(1)
    expect(statusOf(claims)).toBe("reversed")

    await retryPayphoneReversals({
      graceSeconds: 0,
      listWork: async () =>
        [...claims.rows.values()].filter((row) => row.status === "needs_reversal"),
      claimReversal: async () => null,
      markReversed: async () => undefined,
      releaseReversal: async () => undefined,
      markCaptured: async () => undefined,
      findOrderId: async () => null,
      reverse: async () => {
        jobReverses += 1
      },
    })

    expect(jobReverses).toBe(1)
  })

  it("marks needs_reversal and does not reverse when order creation times out", async () => {
    const { run, reverseCalls, claims } = harness({
      completeTimeoutMs: 20,
      complete: () => new Promise(() => undefined),
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.failed)
    expect(reverseCalls).toEqual([])
    expect(statusOf(claims)).toBe("needs_reversal")
  })

  it("reverses when the cart total changed after payment started", async () => {
    const { run, confirmCalls, reverseCalls, completes, claims } = harness({
      cartTotal: "36.00",
      initiatedAmountCents: 3500,
    })

    await expect(run()).rejects.toThrow(PayphoneResultCode.cartChanged)
    expect(confirmCalls).toHaveLength(0)
    expect(reverseCalls).toEqual([42])
    expect(completes()).toBe(0)
    expect(statusOf(claims)).toBe("reversed")
  })
})
