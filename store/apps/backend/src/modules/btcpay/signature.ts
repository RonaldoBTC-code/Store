import { createHmac, timingSafeEqual } from "crypto"

/**
 * BTCPay signs the exact raw request bytes.
 * The `BTCPay-Sig` header is `sha256=` plus the lowercase hex HMAC-SHA256
 * of those bytes, keyed with the webhook secret.
 * https://docs.btcpayserver.org/Development/GreenFieldExample-NodeJS/
 */
export function verifyBtcpaySignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string
): boolean {
  if (!header || !secret) {
    return false
  }

  const hmac = createHmac("sha256", secret)
  hmac.update(rawBody)
  const expected = Buffer.from(`sha256=${hmac.digest("hex")}`, "utf8")
  const received = Buffer.from(header.trim(), "utf8")

  if (expected.length !== received.length) {
    return false
  }

  return timingSafeEqual(expected, received)
}

export function readRawBody(rawData: unknown): Buffer | string | null {
  if (typeof rawData === "string") {
    return rawData
  }
  if (Buffer.isBuffer(rawData)) {
    return rawData
  }
  if (rawData && typeof rawData === "object") {
    const record = rawData as { type?: unknown; data?: unknown }
    if (record.type === "Buffer" && Array.isArray(record.data)) {
      return Buffer.from(record.data)
    }
  }
  return null
}

export function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined
  }
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue
    }
    if (Array.isArray(value)) {
      return typeof value[0] === "string" ? value[0] : undefined
    }
    return typeof value === "string" ? value : undefined
  }
  return undefined
}
