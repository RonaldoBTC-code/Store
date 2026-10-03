const TAX_KEYS = new Set(["tax_id", "tax_id_type"])

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
