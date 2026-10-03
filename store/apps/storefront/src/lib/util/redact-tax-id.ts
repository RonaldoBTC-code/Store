const TAX_KEYS = new Set(["tax_id", "tax_id_type"])

/**
 * Store API paths and query strings identify the cart. Logs keep the route
 * and drop the id. Invoice ids are dropped the same way if they ever appear.
 */
export function redactRequestUrl(url: string): string {
  return url
    .replace(/\/store\/carts\/[^/?#]+/g, "/store/carts/[redacted]")
    .replace(/([?&](?:cart_id|tax_id|tax_id_type)=)[^&#]*/gi, "$1[redacted]")
}

/**
 * Returns a copy safe to log. Invoice identifiers stay out of server logs.
 */
export function redactTaxIdentifiers<T>(value: T): T {
  return redact(value) as T
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const output: Record<string, unknown> = {}

  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    output[key] = TAX_KEYS.has(key) ? "[redacted]" : redact(nested)
  }

  return output
}
