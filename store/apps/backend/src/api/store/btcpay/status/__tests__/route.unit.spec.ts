import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { GET } from "../route"
import {
  resetStatusRateLimiters,
  STATUS_NOT_FOUND,
} from "../../../../../modules/btcpay/status-access"

const NOT_FOUND_BODY = { state: "failed", message: STATUS_NOT_FOUND }
const ENV_KEYS = [
  "BTCPAY_URL",
  "BTCPAY_STORE_ID",
  "BTCPAY_API_KEY",
  "BTCPAY_WEBHOOK_SECRET",
] as const

type Cart = {
  id: string
  customer_id: string | null
  total: number
  currency_code: string
  region: { countries: { iso_2: string }[] }
  payment_collection: {
    payment_sessions: {
      id: string
      provider_id: string
      amount: number
      data: Record<string, unknown>
    }[]
  }
}

describe("GET /store/btcpay/status", () => {
  const previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

  beforeEach(() => {
    resetStatusRateLimiters()
    for (const key of ENV_KEYS) {
      previous[key] = process.env[key]
    }
    process.env.BTCPAY_URL = "https://btcpay.example"
    process.env.BTCPAY_STORE_ID = "store123"
    process.env.BTCPAY_API_KEY = "test-key"
    process.env.BTCPAY_WEBHOOK_SECRET = "webhook-secret"
  })

  afterEach(() => {
    resetStatusRateLimiters()
    for (const key of ENV_KEYS) {
      if (previous[key] == null) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }
  })

  it("returns the same status and body for an unknown cart and a foreign cart", async () => {
    const unknown = await callGet({
      query: { cart_id: "cart_missing", payment_session_id: "payses_missing" },
      carts: [],
    })
    const foreign = await callGet({
      query: { cart_id: "cart_foreign", payment_session_id: "payses_foreign" },
      actorId: "cus_other",
      carts: [
        cart({
          id: "cart_foreign",
          customerId: "cus_owner",
          sessionId: "payses_foreign",
        }),
      ],
    })

    expect(unknown.queries).toBe(1)
    expect(foreign.queries).toBe(1)
    expect(unknown.statusCode).toBe(foreign.statusCode)
    expect(unknown.body).toEqual(foreign.body)
    expect(unknown.statusCode).toBe(404)
    expect(unknown.body).toEqual(NOT_FOUND_BODY)
    expect(JSON.stringify(unknown.body)).not.toContain("cart_missing")
    expect(JSON.stringify(foreign.body)).not.toContain("cart_foreign")
    expect(JSON.stringify(foreign.body)).not.toContain("cus_owner")
  })
})

function cart(input: { id: string; customerId: string | null; sessionId: string }): Cart {
  return {
    id: input.id,
    customer_id: input.customerId,
    total: 10,
    currency_code: "usd",
    region: { countries: [{ iso_2: "ec" }] },
    payment_collection: {
      payment_sessions: [
        {
          id: input.sessionId,
          provider_id: "pp_btcpay_btcpay",
          amount: 10,
          data: {
            invoice_id: "inv_hidden",
            cart_id: input.id,
            amount_cents: 1000,
          },
        },
      ],
    },
  }
}

async function callGet(input: {
  query: Record<string, string>
  carts: Cart[]
  actorId?: string
}) {
  let queries = 0
  const body: { statusCode: number; body?: unknown; queries: number } = {
    statusCode: 200,
    queries: 0,
  }
  const res = {
    status(code: number) {
      body.statusCode = code
      return this
    },
    json(payload: unknown) {
      body.body = payload
      return this
    },
  }
  const req = {
    ip: "203.0.113.50",
    query: input.query,
    socket: { remoteAddress: "203.0.113.50" },
    auth_context: input.actorId
      ? { actor_type: "customer", actor_id: input.actorId }
      : undefined,
    scope: {
      resolve: () => ({
        graph: async () => {
          queries += 1
          return { data: input.carts }
        },
      }),
    },
  }
  await GET(req as unknown as MedusaStoreRequest, res as unknown as MedusaResponse)
  body.queries = queries
  return body
}
