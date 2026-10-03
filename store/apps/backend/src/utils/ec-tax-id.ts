/**
 * Ecuador invoice id checks for the store API.
 * Same rules as store/apps/storefront/src/lib/util/ec-tax-id.ts — keep them in sync.
 * Error text never includes the submitted number.
 */

export const TAX_ID_TYPES = ["cedula", "ruc", "consumidor_final"] as const

export type TaxIdType = (typeof TAX_ID_TYPES)[number]

export const CONSUMIDOR_FINAL_TAX_ID = "9999999999999"

export const TAX_ID_REQUIRED_MESSAGE =
  "Ingresa una cédula, un RUC o elige consumidor final."

export type TaxIdMetadata = {
  tax_id: string
  tax_id_type: TaxIdType
}

const PUBLIC_RUC_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2, 1]
const PRIVATE_RUC_WEIGHTS = [4, 3, 2, 7, 6, 5, 4, 3, 2, 1]

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/g, "")
}

function isProvinceCode(digits: string): boolean {
  const province = digits.slice(0, 2)
  return (
    (province >= "01" && province <= "24") ||
    province === "30" ||
    province === "50"
  )
}

function weightedSum(digits: string, weights: number[]): number {
  let sum = 0

  for (let index = 0; index < weights.length; index++) {
    sum += Number(digits[index]) * weights[index]
  }

  return sum
}

/**
 * Ecuadorian cédula, aligned with python-stdnum `ec.ci`:
 * 10 digits, province 01–24, 30, or 50, third digit 0–6,
 * módulo 10 over all 10 digits.
 */
export function isValidCedula(value: string): boolean {
  const cedula = normalizeTaxId(value)

  if (!/^\d{10}$/.test(cedula) || !isProvinceCode(cedula)) {
    return false
  }

  if (cedula[2] > "6") {
    return false
  }

  let sum = 0

  for (let index = 0; index < cedula.length; index++) {
    let product = (index % 2 === 0 ? 2 : 1) * Number(cedula[index])
    if (product > 9) {
      product -= 9
    }
    sum += product
  }

  return sum % 10 === 0
}

function isPublicRuc(ruc: string): boolean {
  return (
    ruc.slice(-4) !== "0000" && weightedSum(ruc, PUBLIC_RUC_WEIGHTS) % 11 === 0
  )
}

function isPrivateRuc(ruc: string): boolean {
  return (
    ruc.slice(-3) !== "000" &&
    weightedSum(ruc.slice(0, 10), PRIVATE_RUC_WEIGHTS) % 11 === 0
  )
}

function isNaturalRuc(ruc: string): boolean {
  return ruc.slice(-3) !== "000" && isValidCedula(ruc.slice(0, 10))
}

/**
 * Ecuadorian RUC, aligned with python-stdnum `ec.ruc`.
 * Third digit 0–5 is a natural person. Third digit 6 is a public entity
 * or a natural person. Third digit 9 is a public entity or a private company.
 * The establishment suffix cannot be all zeroes.
 */
export function isValidRuc(value: string): boolean {
  const ruc = normalizeTaxId(value)

  if (!/^\d{13}$/.test(ruc) || !isProvinceCode(ruc)) {
    return false
  }

  const third = ruc[2]

  if (third < "6") {
    return isNaturalRuc(ruc)
  }

  if (third === "6") {
    return isPublicRuc(ruc) || isNaturalRuc(ruc)
  }

  if (third === "9") {
    return isPublicRuc(ruc) || isPrivateRuc(ruc)
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const SHIPPING_TAX_MESSAGE =
  "La identificación tributaria no va en la dirección de envío."
const CONSUMIDOR_FINAL_MESSAGE = "Consumidor final no lleva otro número."

function invoiceKeysPresent(metadata: unknown): boolean {
  const record = asRecord(metadata)
  if (!record) {
    return false
  }

  return (
    Object.prototype.hasOwnProperty.call(record, "tax_id") ||
    Object.prototype.hasOwnProperty.call(record, "tax_id_type")
  )
}

/**
 * Accepts only an invoice id that is already normalized.
 * Does not strip dashes, rewrite consumidor final, or change the object.
 */
export function invoiceMetadataRejection(metadata: unknown): string | null {
  const record = asRecord(metadata)
  if (!record) {
    return TAX_ID_REQUIRED_MESSAGE
  }

  const type = record.tax_id_type
  const id = record.tax_id

  if (typeof type !== "string" || typeof id !== "string") {
    return TAX_ID_REQUIRED_MESSAGE
  }

  if (type === "consumidor_final") {
    return id === CONSUMIDOR_FINAL_TAX_ID ? null : CONSUMIDOR_FINAL_MESSAGE
  }

  if (type !== "cedula" && type !== "ruc") {
    return "Elige cédula, RUC o consumidor final."
  }

  const digits = type === "cedula" ? /^\d{10}$/ : /^\d{13}$/
  const valid = type === "cedula" ? isValidCedula(id) : isValidRuc(id)

  if (!digits.test(id) || !valid) {
    return type === "cedula"
      ? "La cédula no es válida. Revisa que tenga 10 dígitos."
      : "El RUC no es válido. Revisa que tenga 13 dígitos."
  }

  return null
}

export function normalizeTaxMetadata(
  metadata: unknown
): { ok: true; metadata: TaxIdMetadata } | { ok: false; message: string } {
  const message = invoiceMetadataRejection(metadata)
  if (message) {
    return { ok: false, message }
  }

  const record = asRecord(metadata) as {
    tax_id: string
    tax_id_type: TaxIdType
  }

  return {
    ok: true,
    metadata: {
      tax_id: record.tax_id,
      tax_id_type: record.tax_id_type,
    },
  }
}

function phoneRejection(
  address: Record<string, unknown>,
  which: "Shipping" | "Billing"
): string | null {
  const phone = address.phone
  if (typeof phone !== "string" || phone.trim() === "") {
    return which === "Shipping"
      ? "Shipping phone is required."
      : "Billing phone is required."
  }

  return null
}

/**
 * Route and updateCartWorkflow gate. Returns an error message, or null.
 * The body is not modified: Medusa persists the validated copy, not this object
 * after a middleware rewrite.
 */
export function cartUpdateRejection(body: unknown): string | null {
  const record = asRecord(body)
  if (!record) {
    return null
  }

  if (Object.prototype.hasOwnProperty.call(record, "shipping_address")) {
    const shipping = record.shipping_address
    if (shipping !== null && shipping !== undefined) {
      const address = asRecord(shipping)
      if (!address) {
        return "Shipping phone is required."
      }
      if (invoiceKeysPresent(address.metadata)) {
        return SHIPPING_TAX_MESSAGE
      }
      const phone = phoneRejection(address, "Shipping")
      if (phone) {
        return phone
      }
    }
  }

  if (!Object.prototype.hasOwnProperty.call(record, "billing_address")) {
    return null
  }

  const billing = asRecord(record.billing_address)
  if (!billing) {
    return TAX_ID_REQUIRED_MESSAGE
  }

  const phone = phoneRejection(billing, "Billing")
  if (phone) {
    return phone
  }

  // Omitting metadata leaves the stored invoice id in place.
  if (!Object.prototype.hasOwnProperty.call(billing, "metadata")) {
    return null
  }

  return invoiceMetadataRejection(billing.metadata)
}

/**
 * completeCartWorkflow gate. The cart argument is the snapshot the workflow
 * already loaded, which is what the order is built from.
 */
export function cartCompletionRejection(cart: unknown): string | null {
  const record = asRecord(cart)
  if (!record) {
    return "The cart could not be completed."
  }

  const message = cartUpdateRejection({
    shipping_address: record.shipping_address,
    billing_address: record.billing_address,
  })
  if (message) {
    return message
  }

  const billing = asRecord(record.billing_address)
  if (!billing || !Object.prototype.hasOwnProperty.call(billing, "metadata")) {
    return TAX_ID_REQUIRED_MESSAGE
  }

  return null
}
