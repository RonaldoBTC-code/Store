import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, MathBN, MedusaError } from "@medusajs/framework/utils"

/**
 * PayPhone's documented identity, in integer cents:
 * amount = amountWithoutTax + amountWithTax + tax + service + tip.
 * amountWithTax is the taxable base (tax not included).
 * amountWithoutTax is the slice of the total that has no tax.
 * https://docs.payphone.app/boton-de-pago
 */
export type PayphoneAmountSplit = {
  amount: number
  amountWithoutTax: number
  amountWithTax: number
  tax: number
  service: number
  tip: number
}

export type CartChargeTotals = {
  /** Medusa cart.total, major units, tax-inclusive. */
  total: BigNumberInput
  /** Medusa cart.tax_total, major units. Already computed by Medusa. */
  taxTotal: BigNumberInput
  /**
   * Major-unit slice of `total` that Medusa did not tax
   * (for example shipping whose shipping_tax_total is 0).
   */
  untaxedTotal?: BigNumberInput
}

/**
 * Converts a Medusa major-unit USD amount to integer cents.
 * Half a cent rounds away from zero. The scaled decimal comes from
 * MathBN, then the rounding uses the decimal string, not a binary float.
 */
export function toUsdCents(amount: BigNumberInput): number {
  const scaled = new BigNumber(MathBN.mult(amount, 100))
  const raw = String(scaled.raw?.value ?? scaled.numeric)
  const cents = roundHalfAwayFromZero(raw)

  if (!Number.isSafeInteger(cents)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  return cents
}

export function centsToUsd(cents: number): number {
  if (!Number.isSafeInteger(cents)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  return new BigNumber(MathBN.div(cents, 100)).numeric
}

/**
 * Builds the PayPhone split from Medusa's cart totals.
 * amountWithTax is the remainder so the cents identity holds exactly.
 */
export function splitFromCartTotals(totals: CartChargeTotals): PayphoneAmountSplit {
  const amount = toUsdCents(totals.total)
  const tax = toUsdCents(totals.taxTotal)
  const amountWithoutTax = toUsdCents(totals.untaxedTotal ?? 0)

  if (amount < 0 || tax < 0 || amountWithoutTax < 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  const amountWithTax = amount - amountWithoutTax - tax

  if (amountWithTax < 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "El desglose de IVA no cuadra con el total"
    )
  }

  return {
    amount,
    amountWithoutTax,
    amountWithTax,
    tax,
    service: 0,
    tip: 0,
  }
}

/**
 * Shipping Medusa left untaxed. A taxed shipping line stays inside
 * amountWithTax / tax, which are derived from the stored totals.
 */
export function untaxedMajorFromCart(cart: {
  shipping_total?: BigNumberInput | null
  shipping_tax_total?: BigNumberInput | null
}): BigNumberInput {
  if (toUsdCents(cart.shipping_tax_total ?? 0) === 0) {
    return cart.shipping_total ?? 0
  }

  return 0
}

export function splitSumsToAmount(split: PayphoneAmountSplit): boolean {
  return (
    split.amountWithoutTax +
      split.amountWithTax +
      split.tax +
      split.service +
      split.tip ===
    split.amount
  )
}

function roundHalfAwayFromZero(decimal: string): number {
  const trimmed = decimal.trim()
  const negative = trimmed.startsWith("-")
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [wholeRaw, fraction = ""] = unsigned.split(".")
  const whole = wholeRaw === "" ? "0" : wholeRaw

  if (!/^\d+$/.test(whole) || (fraction !== "" && !/^\d+$/.test(fraction))) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  let cents = BigInt(whole)
  const halfDigit = fraction[0] ?? "0"

  if (halfDigit >= "5") {
    cents += 1n
  }

  if (negative && cents !== 0n) {
    cents = -cents
  }

  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  return Number(cents)
}
