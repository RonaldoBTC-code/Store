export const TAX_ID_TYPES = ["cedula", "ruc", "consumidor_final"] as const

export type TaxIdType = (typeof TAX_ID_TYPES)[number]

/** SRI identification used when the buyer does not request a named invoice. */
export const CONSUMIDOR_FINAL_TAX_ID = "9999999999999"

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
