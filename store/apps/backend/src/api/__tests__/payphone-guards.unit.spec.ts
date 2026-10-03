import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
} from "../../modules/payphone/providers"
import middlewares, {
  blockManualPaymentCompletion,
  blockManualPaymentSession,
  blockPayphoneCartCompletion,
  payphoneClientSessionData,
} from "../middlewares"
import { createPayphoneRateLimit } from "../payphone-rate-limit"

describe("PayPhone store guards", () => {
  it("drops payphone_confirmed sent by the client", () => {
    const data = payphoneClientSessionData(
      {
        payphone_confirmed: true,
        transaction_status: "Approved",
        transaction_id: 42,
        authorization_code: "W1",
        cart_note: "keep",
      },
      { id: "cart_1", taxTotal: 1.5, untaxedTotal: 0 }
    )

    expect(data.payphone_confirmed).toBeUndefined()
    expect(data.transaction_status).toBeUndefined()
    expect(data.transaction_id).toBeUndefined()
    expect(data.authorization_code).toBeUndefined()
    expect(data).toMatchObject({
      cart_note: "keep",
      cart_id: "cart_1",
      cart_tax_total: 1.5,
      cart_untaxed_total: 0,
    })
  })

  it("blocks POST /store/carts/:id/complete when the session is PayPhone", async () => {
    const route = (
      middlewares as {
        routes: {
          matcher: string
          methods?: string[]
          middlewares: ((
            req: unknown,
            res: unknown,
            next: () => void
          ) => Promise<void> | void)[]
        }[]
      }
    ).routes.find((entry) => entry.matcher === "/store/carts/:id/complete")

    expect(route?.methods).toEqual(["POST"])
    expect(route?.middlewares).toEqual([
      blockManualPaymentCompletion,
      blockPayphoneCartCompletion,
    ])

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const req = {
      params: { id: "cart_1" },
      body: {},
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [
              {
                payment_collection: {
                  payment_sessions: [{ provider_id: PAYPHONE_PROVIDER_ID }],
                },
              },
            ],
          }),
        }),
      },
    }

    let blocked = false
    for (const middleware of route?.middlewares ?? []) {
      const next = jest.fn()
      await middleware(req, res, next)
      if (!next.mock.calls.length) {
        blocked = true
        break
      }
    }

    expect(blocked).toBe(true)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "payphone_direct_complete_blocked" })
    )
  })

  it("blocks a manual payment session in production", async () => {
    await withProcessEnv({ NODE_ENV: "production" }, async () => {
      const next = jest.fn()
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await blockManualPaymentSession(
        { body: { provider_id: SYSTEM_PROVIDER_ID } } as never,
        res as never,
        next
      )

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "test_payment_disabled" })
      )

      const allowed = jest.fn()
      await blockManualPaymentSession(
        { body: { provider_id: PAYPHONE_PROVIDER_ID } } as never,
        { status: jest.fn().mockReturnThis(), json: jest.fn() } as never,
        allowed
      )
      expect(allowed).toHaveBeenCalledTimes(1)
    })
  })

  it("blocks manual cart completion in production", async () => {
    await withProcessEnv({ NODE_ENV: "production" }, async () => {
      const next = jest.fn()
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }
      const graph = jest.fn(async () => ({
        data: [
          {
            payment_collection: {
              payment_sessions: [{ provider_id: SYSTEM_PROVIDER_ID }],
            },
          },
        ],
      }))

      await blockManualPaymentCompletion(
        {
          params: { id: "cart_manual" },
          scope: { resolve: () => ({ graph }) },
        } as never,
        res as never,
        next
      )

      expect(graph).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "test_payment_disabled" })
      )
    })
  })

  it("lets manual payments through outside production", async () => {
    const next = jest.fn()
    const graph = jest.fn()

    await blockManualPaymentSession(
      { body: { provider_id: SYSTEM_PROVIDER_ID } } as never,
      { status: jest.fn(), json: jest.fn() } as never,
      next
    )
    await blockManualPaymentCompletion(
      {
        params: { id: "cart_manual" },
        scope: { resolve: () => ({ graph }) },
      } as never,
      { status: jest.fn(), json: jest.fn() } as never,
      next
    )

    expect(next).toHaveBeenCalledTimes(2)
    expect(graph).not.toHaveBeenCalled()
  })

  it("blocks direct cart completion when the session is PayPhone", async () => {
    const next = jest.fn()
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const req = {
      params: { id: "cart_1" },
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [
              {
                payment_collection: {
                  payment_sessions: [
                    { provider_id: PAYPHONE_PROVIDER_ID },
                    { provider_id: SYSTEM_PROVIDER_ID },
                  ],
                },
              },
            ],
          }),
        }),
      },
    }

    await blockPayphoneCartCompletion(req as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "payphone_direct_complete_blocked" })
    )
  })

  it("lets a cart without PayPhone continue", async () => {
    const next = jest.fn()
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const req = {
      params: { id: "cart_1" },
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [
              {
                payment_collection: {
                  payment_sessions: [{ provider_id: SYSTEM_PROVIDER_ID }],
                },
              },
            ],
          }),
        }),
      },
    }

    await blockPayphoneCartCompletion(req as never, res as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it("rate limits the notification and complete routes", () => {
    let now = 1_000
    const limit = createPayphoneRateLimit({
      scope: "test",
      max: 2,
      windowMs: 1_000,
      now: () => now,
    })
    const next = jest.fn()
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const req = { ip: "203.0.113.8", headers: {} }

    limit(req as never, res as never, next)
    limit(req as never, res as never, next)
    limit(req as never, res as never, next)

    expect(next).toHaveBeenCalledTimes(2)
    expect(res.status).toHaveBeenCalledWith(429)

    now += 1_000
    limit(req as never, res as never, next)
    expect(next).toHaveBeenCalledTimes(3)
  })
})

async function withProcessEnv(
  env: { NODE_ENV?: string; ALLOW_TEST_PAYMENTS?: string },
  run: () => Promise<void>
) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_TEST_PAYMENTS: process.env.ALLOW_TEST_PAYMENTS,
  }

  apply(env)

  try {
    await run()
  } finally {
    apply(previous)
  }
}

function apply(env: { NODE_ENV?: string; ALLOW_TEST_PAYMENTS?: string }) {
  if (env.NODE_ENV === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = env.NODE_ENV
  }

  if (env.ALLOW_TEST_PAYMENTS === undefined) {
    delete process.env.ALLOW_TEST_PAYMENTS
  } else {
    process.env.ALLOW_TEST_PAYMENTS = env.ALLOW_TEST_PAYMENTS
  }
}
