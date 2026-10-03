import { createHash, createHmac } from "crypto"
import { migration170000Up } from "../../btcpay-claim/migrations/sql"
import {
  hashClientIp,
  hashPersonal,
  hashSessionId,
  OPEN_PAYMENT_STATUSES,
  personalDataSecret,
  resolveLimits,
} from "../limits"
import { redactionLogLine } from "../payment-sql"

const SECRET = "server-secret"
const OTHER = "other-secret"

describe("BTCPay personal data hashes", () => {
  it("stores an HMAC of the IP and not the raw address", () => {
    const ip = "203.0.113.10"
    const hash = hashClientIp(ip, SECRET)
    const again = hashClientIp(` ${ip.toUpperCase()} `, SECRET)

    expect(hash).toBe(again)
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(ip)
    expect(hash).toBe(createHmac("sha256", SECRET).update(ip).digest("hex"))
    expect(hash).not.toBe(createHash("sha256").update(ip).digest("hex"))
    expect(hashClientIp(ip, OTHER)).not.toBe(hash)
    expect(hashClientIp("::ffff:203.0.113.10", SECRET)).toBe(hash)
    expect(hashClientIp("  ", SECRET)).toBeNull()
    expect(hashClientIp(ip, "  ")).toBeNull()
  })

  it("stores an HMAC of the session id and not the raw id", () => {
    const sessionId = "payses_1"
    const hash = hashSessionId(sessionId, SECRET)

    expect(hash).toBe(hashPersonal(sessionId, SECRET))
    expect(hash).not.toBe(sessionId)
    expect(hash).not.toContain("payses")
    expect(hashSessionId(sessionId, SECRET)).toBe(hash)
    expect(hashSessionId(sessionId, OTHER)).not.toBe(hash)
    expect(hashSessionId("Payses_1", SECRET)).not.toBe(hash)
  })

  it("prefers the dedicated HMAC secret and otherwise the webhook secret", () => {
    expect(
      personalDataSecret({
        BTCPAY_PII_HMAC_SECRET: " dedicated ",
        BTCPAY_WEBHOOK_SECRET: "webhook",
      })
    ).toBe("dedicated")
    expect(personalDataSecret({ BTCPAY_WEBHOOK_SECRET: " webhook " })).toBe("webhook")
    expect(personalDataSecret({})).toBe("")
  })

  it("keeps one open invoice per cart even when env asks for more", () => {
    expect(resolveLimits({ maxPendingPerCart: 5 }).maxPendingPerCart).toBe(1)
    expect(resolveLimits({}, { BTCPAY_MAX_PENDING_PER_CART: "9" }).maxPendingPerCart).toBe(1)
  })

  it("uses holding and pending as the open statuses in the cart unique index", () => {
    const sql = migration170000Up.join("\n")
    expect(OPEN_PAYMENT_STATUSES).toEqual(["holding", "pending"])
    expect(sql).toContain("status IN ('holding', 'pending')")
    expect(sql).toContain(
      `UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_invoice_id_unique"`
    )
    expect(sql).not.toMatch(/float|double precision|real/i)
  })

  it("logs only the redaction count", () => {
    const line = redactionLogLine(4)
    expect(line).toBe("BTCPay personal-data redaction updated 4 rows.")
    expect(line).not.toMatch(/ip|session|hash|@/i)
  })
})
