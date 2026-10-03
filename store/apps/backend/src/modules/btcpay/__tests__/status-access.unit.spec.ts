import {
  allowStatusRequest,
  callerOwnsCart,
  hashRateLimitKey,
  publicStatus,
  readStatusQuery,
  resetStatusRateLimiters,
  StatusRateLimiter,
} from "../status-access"

describe("BTCPay status access", () => {
  it("ignores an invoice id and only reads the cart and payment session", () => {
    expect(
      readStatusQuery({
        invoice_id: "inv_other",
        cart_id: "cart_1",
        payment_session_id: "payses_1",
        status: "Settled",
      })
    ).toEqual({
      cartId: "cart_1",
      paymentSessionId: "payses_1",
    })
  })

  it("allows the caller who holds the payment session on their own cart", () => {
    expect(
      callerOwnsCart({
        actorId: "cus_1",
        cartCustomerId: "cus_1",
        paymentSessionId: "payses_1",
        cartSessionId: "payses_1",
      })
    ).toBe(true)
    expect(
      callerOwnsCart({
        actorId: null,
        cartCustomerId: null,
        paymentSessionId: "payses_1",
        cartSessionId: "payses_1",
      })
    ).toBe(true)
  })

  it("refuses another customer, a missing session, and an invoice-only lookup", () => {
    expect(
      callerOwnsCart({
        actorId: "cus_2",
        cartCustomerId: "cus_1",
        paymentSessionId: "payses_1",
        cartSessionId: "payses_1",
      })
    ).toBe(false)
    expect(
      callerOwnsCart({
        actorId: null,
        cartCustomerId: "cus_1",
        paymentSessionId: "payses_1",
        cartSessionId: "payses_1",
      })
    ).toBe(false)
    expect(
      callerOwnsCart({
        actorId: null,
        cartCustomerId: null,
        paymentSessionId: "",
        cartSessionId: "payses_1",
      })
    ).toBe(false)
  })

  it("returns only status fields", () => {
    expect(
      publicStatus({
        state: "pending",
        message: "pago pendiente de confirmación",
        expires_at: "2026-10-03T15:00:00.000Z",
        order_id: "order_1",
      })
    ).toEqual({
      state: "pending",
      message: "pago pendiente de confirmación",
      expires_at: "2026-10-03T15:00:00.000Z",
      order_id: "order_1",
    })
    const body = publicStatus({
      state: "failed",
      message: "No encontramos el carrito.",
    })
    expect(Object.keys(body).sort()).toEqual(["message", "state"])
    expect(JSON.stringify(body)).not.toMatch(/email|customer|invoice/i)
  })

  it("stops an IP or cart that exceeds the status window", () => {
    const limiter = new StatusRateLimiter(2, 60_000)
    const ip = hashRateLimitKey("203.0.113.10")
    expect(limiter.allow(ip, 1_000)).toBe(true)
    expect(limiter.allow(ip, 1_100)).toBe(true)
    expect(limiter.allow(ip, 1_200)).toBe(false)
    expect(limiter.allow(ip, 62_000)).toBe(true)
  })

  it("resets the shared status limiter map", () => {
    const env = {
      BTCPAY_STATUS_MAX_REQUESTS: "1",
      BTCPAY_STATUS_WINDOW_SECONDS: "60",
    } as NodeJS.ProcessEnv
    resetStatusRateLimiters()
    expect(allowStatusRequest(["ip:one"], 1_000, env)).toBe(true)
    expect(allowStatusRequest(["ip:one"], 1_100, env)).toBe(false)
    resetStatusRateLimiters()
    expect(allowStatusRequest(["ip:one"], 1_200, env)).toBe(true)
    resetStatusRateLimiters()
  })
})
