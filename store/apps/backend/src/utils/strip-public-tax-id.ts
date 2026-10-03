const TAX_KEYS = ["tax_id", "tax_id_type"] as const

/**
 * Store API responses must not carry an invoice number.
 * `*billing_address` and `+billing_address.*` still load the metadata column,
 * and `req.disallowed` cannot remove a key inside that JSON. This walk
 * replaces `tax_id` / `tax_id_type` on every metadata object with flags.
 * Admin routes are not passed through `sanitizeStoreResponse`.
 */
export function stripPublicTaxIdentifiers<T>(value: T): T {
  return walk(value) as T
}

export function isStoreApiPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? ""
  return pathname === "/store" || pathname.startsWith("/store/")
}

export function sanitizeStoreResponse<T>(url: string, body: T): T {
  if (!isStoreApiPath(url)) {
    return body
  }

  return stripPublicTaxIdentifiers(body)
}

type ResponseLike = {
  json: (body?: unknown) => unknown
  send: (body?: unknown) => unknown
  end?: (chunk?: unknown, ...rest: unknown[]) => unknown
  write?: (chunk?: unknown, ...rest: unknown[]) => unknown
}

/**
 * Covers `res.json`, `res.send`, `res.end`, and `res.write`.
 * `res.json` in Express calls `res.send`, so the replacement is idempotent.
 * Buffers are left unchanged: store routes answer with JSON, not file streams.
 */
export function installStoreTaxIdSanitizer(res: ResponseLike): void {
  const sendJson = res.json.bind(res)
  const send = res.send.bind(res)

  res.json = (body?: unknown) => sendJson(stripPublicTaxIdentifiers(body))

  res.send = (body?: unknown) => send(sanitizeOutbound(body))

  if (typeof res.end === "function") {
    const end = res.end.bind(res)
    res.end = function (chunk?: unknown, ...rest: unknown[]) {
      if (arguments.length === 0 || typeof chunk === "function") {
        return end(chunk, ...rest)
      }
      return end(sanitizeOutbound(chunk), ...rest)
    }
  }

  if (typeof res.write === "function") {
    const write = res.write.bind(res)
    res.write = (chunk?: unknown, ...rest: unknown[]) =>
      write(sanitizeOutbound(chunk), ...rest)
  }
}

function sanitizeOutbound(body: unknown): unknown {
  if (typeof body === "string") {
    const trimmed = body.trim()
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return body
    }

    try {
      return JSON.stringify(stripPublicTaxIdentifiers(JSON.parse(body)))
    } catch {
      return body
    }
  }

  if (!body || typeof body !== "object" || Buffer.isBuffer(body)) {
    return body
  }

  return stripPublicTaxIdentifiers(body)
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
    if (key === "metadata") {
      const record = asRecord(nested)
      if (record) {
        output[key] = walk(replaceInvoiceMetadata(record))
        continue
      }
    }

    output[key] = walk(nested)
  }

  return output
}

function replaceInvoiceMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const hasInvoiceKey = TAX_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(metadata, key)
  )

  if (!hasInvoiceKey) {
    return metadata
  }

  const next = { ...metadata }
  const type = next.tax_id_type
  const id = next.tax_id
  const isFinal = type === "consumidor_final"
  const identified =
    isFinal ||
    type === "cedula" ||
    type === "ruc" ||
    (typeof id === "string" && id.length > 0)

  delete next.tax_id
  delete next.tax_id_type

  if (identified) {
    next.tax_id_set = true
    next.tax_id_kind = isFinal ? "consumidor_final" : "identificado"
  } else {
    next.tax_id_set = false
    delete next.tax_id_kind
  }

  return next
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}
