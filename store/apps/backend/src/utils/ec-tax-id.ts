/**
 * Ecuador invoice id checks for the store API.
 * Same rules as store/apps/storefront/src/lib/util/ec-tax-id.ts — keep them in sync.
 * Error text never includes the submitted number.
 */

export const TAX_ID_TYPES = ["cedula", "ruc", "consumidor_final"] as const

export type TaxIdType = (typeof TAX_ID_TYPES)[number]

export const CONSUMIDOR_FINAL_TAX_ID = "9999999999999"

export const TAX_ID_REQUIRED_MESSAGE =
  "A valid cédula, RUC, or consumidor final is required."

export type TaxIdMetadata = {
  tax_id: string
  tax_id_type: TaxIdType
}

const CEDULA_COEFFICIENTS = [2, 1, 2, 1, 2, 1, 2, 1, 2]
const PUBLIC_RUC_COEFFICIENTS = [3, 2, 7, 6, 5, 4, 3, 2]
const PRIVATE_RUC_COEFFICIENTS = [4, 3, 2, 7, 6, 5, 4, 3, 2]

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s-]/g, "")
}

function isProvinceCode(digits: string): boolean {
  const province = Number(digits.slice(0, 2))
  return (province >= 1 && province <= 24) || province === 30
}

function module11Matches(
  digits: string,
  coefficients: number[],
  checkIndex: number
): boolean {
  let sum = 0

  for (let index = 0; index < coefficients.length; index++) {
    sum += Number(digits[index]) * coefficients[index]
  }

  const residue = sum % 11
  const expected = residue === 0 ? 0 : 11 - residue

  if (expected === 10) {
    return false
  }

  return expected === Number(digits[checkIndex])
}

export function isValidCedula(value: string): boolean {
  const cedula = normalizeTaxId(value)

  if (!/^\d{10}$/.test(cedula) || !isProvinceCode(cedula)) {
    return false
  }

  if (Number(cedula[2]) > 5) {
    return false
  }

  let sum = 0

  for (let index = 0; index < CEDULA_COEFFICIENTS.length; index++) {
    let product = Number(cedula[index]) * CEDULA_COEFFICIENTS[index]
    if (product >= 10) {
      product -= 9
    }
    sum += product
  }

  const residue = sum % 10
  const expected = residue === 0 ? 0 : 10 - residue

  return expected === Number(cedula[9])
}

export function isValidRuc(value: string): boolean {
  const ruc = normalizeTaxId(value)

  if (!/^\d{13}$/.test(ruc) || !isProvinceCode(ruc)) {
    return false
  }

  const third = Number(ruc[2])

  if (third <= 5) {
    return isValidCedula(ruc.slice(0, 10)) && ruc.slice(10) !== "000"
  }

  if (third === 6) {
    return (
      module11Matches(ruc, PUBLIC_RUC_COEFFICIENTS, 8) &&
      ruc.slice(9) !== "0000"
    )
  }

  if (third === 9) {
    return (
      module11Matches(ruc, PRIVATE_RUC_COEFFICIENTS, 9) &&
      ruc.slice(10) !== "000"
    )
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function parseTaxId(typeRaw: string, idRaw: string): TaxIdMetadata {
  const type = typeRaw.trim()

  if (type === "consumidor_final") {
    return {
      tax_id_type: "consumidor_final",
      tax_id: CONSUMIDOR_FINAL_TAX_ID,
    }
  }

  if (type !== "cedula" && type !== "ruc") {
    throw new Error(TAX_ID_REQUIRED_MESSAGE)
  }

  const taxId = normalizeTaxId(idRaw)

  if (type === "cedula" && !isValidCedula(taxId)) {
    throw new Error("Enter a valid cédula (10 digits).")
  }

  if (type === "ruc" && !isValidRuc(taxId)) {
    throw new Error("Enter a valid RUC (13 digits).")
  }

  return { tax_id_type: type, tax_id: taxId }
}

export function normalizeTaxMetadata(
  metadata: unknown
): { ok: true; metadata: TaxIdMetadata } | { ok: false; message: string } {
  const record = asRecord(metadata)
  if (!record) {
    return { ok: false, message: TAX_ID_REQUIRED_MESSAGE }
  }

  const type = record.tax_id_type
  const id = record.tax_id

  try {
    return {
      ok: true,
      metadata: parseTaxId(
        typeof type === "string" ? type : "",
        typeof id === "string" ? id : ""
      ),
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : TAX_ID_REQUIRED_MESSAGE

    if (/\d{6,}/.test(message)) {
      return { ok: false, message: TAX_ID_REQUIRED_MESSAGE }
    }

    return { ok: false, message }
  }
}

function stripTaxKeys(metadata: unknown): void {
  const record = asRecord(metadata)
  if (!record) {
    return
  }

  delete record.tax_id
  delete record.tax_id_type
}

/**
 * When a cart update includes a billing address, require a valid invoice id
 * and store only the normalized value. Returns an error message, or null.
 * The message never contains the submitted number.
 */
export function applyBillingTaxId(body: unknown): string | null {
  const record = asRecord(body)
  if (!record) {
    return null
  }

  if (Object.prototype.hasOwnProperty.call(record, "shipping_address")) {
    const shipping = asRecord(record.shipping_address)
    if (shipping) {
      stripTaxKeys(shipping.metadata)
    }
  }

  if (!Object.prototype.hasOwnProperty.call(record, "billing_address")) {
    return null
  }

  const address = asRecord(record.billing_address)
  if (!address) {
    return TAX_ID_REQUIRED_MESSAGE
  }

  const normalized = normalizeTaxMetadata(address.metadata)
  if (!normalized.ok) {
    return normalized.message
  }

  const metadata = asRecord(address.metadata) ?? {}
  address.metadata = {
    ...metadata,
    ...normalized.metadata,
  }

  return null
}
