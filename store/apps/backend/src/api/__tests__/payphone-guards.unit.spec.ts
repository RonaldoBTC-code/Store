import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
} from "../../modules/payphone/providers"
import {
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
