import { createHmac } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { verifyBtcpaySignature } from "../signature"
import { btcpayWebhookGuard } from "../webhook-guard"

const SECRET = "webhook-secret"

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res
}

describe("BTCPay webhook guard", () => {
  const previous = process.env.BTCPAY_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.BTCPAY_WEBHOOK_SECRET = SECRET
  })

  afterEach(() => {
    if (previous == null) {
      delete process.env.BTCPAY_WEBHOOK_SECRET
    } else {
      process.env.BTCPAY_WEBHOOK_SECRET = previous
    }
  })

  it("returns 401 for an invalid signature and does not continue", () => {
    const raw = JSON.stringify({ invoiceId: "inv123", type: "InvoiceSettled" })
    const dbWrite = jest.fn()
    const res = response()

    btcpayWebhookGuard(
      {
        rawBody: raw,
        headers: { "btcpay-sig": sign(raw, "other-secret") },
      } as unknown as MedusaRequest,
      res as unknown as MedusaResponse,
      dbWrite
    )

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ message: "Unauthorized" })
    expect(JSON.stringify(res.body)).not.toContain(SECRET)
    expect(dbWrite).not.toHaveBeenCalled()
  })

  it("returns 401 when the signature header is missing and does not write", () => {
    const dbWrite = jest.fn()
    const res = response()

    btcpayWebhookGuard(
      {
        rawBody: "{\"invoiceId\":\"inv123\"}",
        headers: {},
      } as unknown as MedusaRequest,
      res as unknown as MedusaResponse,
      dbWrite
    )

    expect(res.statusCode).toBe(401)
    expect(dbWrite).not.toHaveBeenCalled()
  })

  it("returns 401 when the raw body was not preserved", () => {
    const dbWrite = jest.fn()
    const res = response()
    const raw = "{\"a\":1}"

    btcpayWebhookGuard(
      {
        body: { a: 1 },
        headers: { "btcpay-sig": sign(raw) },
      } as unknown as MedusaRequest,
      res as unknown as MedusaResponse,
      dbWrite
    )

    expect(res.statusCode).toBe(401)
    expect(dbWrite).not.toHaveBeenCalled()
  })

  it("accepts a signature over the raw bytes and rejects a reordered body", () => {
    const raw = "{\"z\":1,\"a\":2}"
    const reordered = "{\"a\":2,\"z\":1}"
    const dbWrite = jest.fn()
    const res = response()

    btcpayWebhookGuard(
      {
        rawBody: raw,
        headers: { "btcpay-sig": sign(reordered) },
      } as unknown as MedusaRequest,
      res as unknown as MedusaResponse,
      dbWrite
    )

    expect(res.statusCode).toBe(401)
    expect(dbWrite).not.toHaveBeenCalled()

    const ok = response()
    btcpayWebhookGuard(
      {
        rawBody: Buffer.from(raw),
        headers: { "BTCPay-Sig": sign(raw) },
      } as unknown as MedusaRequest,
      ok as unknown as MedusaResponse,
      dbWrite
    )

    expect(ok.statusCode).toBe(200)
    expect(dbWrite).toHaveBeenCalledTimes(1)
  })

  it("rejects a different-length signature without throwing", () => {
    expect(verifyBtcpaySignature("{}", "sha256=abc", SECRET)).toBe(false)
    expect(verifyBtcpaySignature("{}", undefined, SECRET)).toBe(false)
  })
})
