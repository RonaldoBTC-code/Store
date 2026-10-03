export const TAX_ID_TYPES = ["cedula", "ruc", "consumidor_final"] as const

export type TaxIdType = (typeof TAX_ID_TYPES)[number]

/** SRI identification used when the buyer does not request a named invoice. */
export const CONSUMIDOR_FINAL_TAX_ID = "9999999999999"

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

/**
 * Ecuadorian cédula: 10 digits, province 01–24 or 30, third digit 0–5,
 * and the módulo 10 check digit.
 */
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

/**
 * Ecuadorian RUC: 13 digits. Natural persons reuse the cédula check;
 * public institutions (third digit 6) and private companies (third digit 9)
 * use módulo 11. The establishment suffix cannot be all zeroes.
 */
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

export type PublicTaxIdKind = "consumidor_final" | "identificado"

export type PublicTaxIdState = {
  taxIdSet: boolean
  taxIdKind: PublicTaxIdKind | null
}

/**
 * Reads the non-sensitive flags the store API returns.
 * The number itself is never copied into the result.
 */
export function publicTaxIdState(metadata: unknown): PublicTaxIdState {
  const record = asRecord(metadata)
  if (!record) {
    return { taxIdSet: false, taxIdKind: null }
  }

  const kind = record.tax_id_kind
  const type = record.tax_id_type

  if (kind === "consumidor_final" || type === "consumidor_final") {
    return { taxIdSet: true, taxIdKind: "consumidor_final" }
  }

  const identified =
    kind === "identificado" ||
    record.tax_id_set === true ||
    type === "cedula" ||
    type === "ruc"

  if (identified) {
    return { taxIdSet: true, taxIdKind: "identificado" }
  }

  return { taxIdSet: false, taxIdKind: null }
}

export function formatTaxIdLabel(metadata: unknown): string | null {
  const state = publicTaxIdState(metadata)
  if (!state.taxIdSet) {
    return null
  }

  return state.taxIdKind === "consumidor_final"
    ? "Consumidor final"
    : "Cédula ingresada"
}

export function taxIdReviewLabel(metadata: unknown): string | null {
  const state = publicTaxIdState(metadata)
  if (!state.taxIdSet) {
    return null
  }

  return state.taxIdKind === "consumidor_final"
    ? "Consumidor final"
    : "Cédula: ingresada"
}

/**
 * Validates an invoice identification and returns the billing metadata to store.
 * Error text never includes the submitted number.
 */
export function parseTaxId(typeRaw: string, idRaw: string): TaxIdMetadata {
  const type = typeRaw.trim()

  if (type === "consumidor_final") {
    return {
      tax_id_type: "consumidor_final",
      tax_id: CONSUMIDOR_FINAL_TAX_ID,
    }
  }

  if (type !== "cedula" && type !== "ruc") {
    throw new Error("Elige cédula, RUC o consumidor final.")
  }

  const taxId = normalizeTaxId(idRaw)

  if (type === "cedula" && !isValidCedula(taxId)) {
    throw new Error("La cédula no es válida. Revisa que tenga 10 dígitos.")
  }

  if (type === "ruc" && !isValidRuc(taxId)) {
    throw new Error("El RUC no es válido. Revisa que tenga 13 dígitos.")
  }

  return { tax_id_type: type, tax_id: taxId }
}
