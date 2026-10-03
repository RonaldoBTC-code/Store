import {
  PAYPHONE_API_BASE,
  PAYPHONE_BROWSER_ORIGINS,
  PayphoneClient,
} from "../client"

describe("PayphoneClient", () => {
  it("posts Prepare, Confirm, and Reverse through the injected fetch", async () => {
    const calls: { url: string; body: unknown; authorization: string }[] = []
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      calls.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")),
        authorization: headers.Authorization,
      })
      const path = String(url)
      const body = path.endsWith("/Prepare")
        ? {
            paymentId: "abc",
            payWithCard: `${PAYPHONE_BROWSER_ORIGINS[0]}/Anonymous/Index?paymentId=abc`,
            payWithPayPhone: `${PAYPHONE_BROWSER_ORIGINS[0]}/PayPhone/Index?paymentId=abc`,
          }
        : path.endsWith("/Confirm")
          ? { statusCode: 3, transactionStatus: "Approved", transactionId: 5 }
          : true

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      }
    })

    const client = new PayphoneClient({
      token: "test-token",
      storeId: "store-1",
      responseUrl: "https://shop.example/api/payphone/return",
      cancellationUrl: "https://shop.example/ec/checkout?step=payment",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.prepare({
      clientTransactionId: "payses_01",
      split: {
        amount: 115,
        amountWithoutTax: 0,
        amountWithTax: 100,
        tax: 15,
        service: 0,
        tip: 0,
      },
    })
    await client.confirm(5, "payses_01")
    await client.reverse(5)

    expect(calls.map((call) => call.url)).toEqual([
      `${PAYPHONE_API_BASE}/api/button/Prepare`,
      `${PAYPHONE_API_BASE}/api/button/V2/Confirm`,
      `${PAYPHONE_API_BASE}/api/Reverse`,
    ])
    expect(calls.every((call) => call.authorization === "Bearer test-token")).toBe(
      true
    )
    expect(calls[1].body).toEqual({ id: 5, clientTxId: "payses_01" })
    expect(calls[2].body).toEqual({ id: 5 })
    expect(calls[0].body).toMatchObject({
      amount: 115,
      tax: 15,
      amountWithTax: 100,
      storeId: "store-1",
    })
  })

  it("lists only the documented browser origin", () => {
    expect(PAYPHONE_BROWSER_ORIGINS).toEqual([
      "https://pay.payphonetodoesposible.com",
    ])
  })
})
