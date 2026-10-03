const ADDRESS_KEYS = new Set(["billing_address", "shipping_address"])
const TAX_KEYS = ["tax_id", "tax_id_type"] as const

/**
 * Removes invoice identifiers from a store API payload.
 * Medusa v2.21 selects address metadata as a whole column (`*billing_address`
 * includes `metadata`), and `req.disallowed` only matches field-path segments,
 * so it cannot drop keys inside that JSON. This walks the serialized body.
 * Admin routes are not passed through here.
 */
export function stripPublicTaxIdentifiers<T>(value: T): T {
  return walk(value) as T
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(walk)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const output: Record<string, unknown> = {}

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (ADDRESS_KEYS.has(key)) {
      output[key] = stripAddress(nested)
      continue
    }

    output[key] = walk(nested)
  }

  return output
}

function stripAddress(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripAddress)
  }

  const copy = walk(value)
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) {
    return copy
  }

  const address = copy as Record<string, unknown>
  const metadata = address.metadata

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return address
  }

  const next = { ...(metadata as Record<string, unknown>) }
  for (const key of TAX_KEYS) {
    delete next[key]
  }
  address.metadata = next

  return address
}
