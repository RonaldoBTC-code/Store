import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, MathBN, MedusaError } from "@medusajs/framework/utils"

/**
 * Ecuador IVA is included in Medusa's USD prices. PayPhone expects the
 * tax-inclusive total split into integer cents:
 * amount = amountWithoutTax + amountWithTax + tax + service + tip.
 * https://docs.payphone.app/boton-de-pago
 */
const IVA_NUMERATOR = 15
const IVA_DENOMINATOR = 115
const USD_MULTIPLIER = 100

export type PayphoneAmountSplit = {
  amount: number
  amountWithoutTax: number
  amountWithTax: number
  tax: number
  service: number
  tip: number
}

export function toUsdCents(amount: BigNumberInput): number {
  const roundedMajor =
    Math.round(new BigNumber(MathBN.mult(amount, USD_MULTIPLIER)).numeric) /
    USD_MULTIPLIER
  const smallest = new BigNumber(MathBN.mult(roundedMajor, USD_MULTIPLIER))
  const whole = smallest.numeric.toString().split(".")[0]
  const cents = Number.parseInt(whole ?? "", 10)

  if (!Number.isSafeInteger(cents)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  return cents
}

export function centsToUsd(cents: number): number {
  if (!Number.isSafeInteger(cents)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  return new BigNumber(MathBN.div(cents, USD_MULTIPLIER)).numeric
}

/**
 * Splits a tax-inclusive USD amount into PayPhone cents.
 * The whole charge is treated as 15% IVA inclusive. Shipping is not split
 * out: the payment session only carries the total.
 */
export function splitInclusiveIva(amount: BigNumberInput): PayphoneAmountSplit {
  const amountCents = toUsdCents(amount)

  if (amountCents < 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Monto inválido")
  }

  const tax = Math.round((amountCents * IVA_NUMERATOR) / IVA_DENOMINATOR)
  const amountWithTax = amountCents - tax
  const split: PayphoneAmountSplit = {
    amount: amountCents,
    amountWithoutTax: 0,
    amountWithTax,
    tax,
    service: 0,
    tip: 0,
  }
  const sum =
    split.amountWithoutTax +
    split.amountWithTax +
    split.tax +
    split.service +
    split.tip

  if (sum !== split.amount) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "El desglose de IVA no cuadra con el total"
    )
  }

  return split
}
