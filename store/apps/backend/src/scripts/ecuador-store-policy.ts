export const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"
export const ECUADOR_STOCK_LOCATION_NAME = "Ecuador"

export type StoreCurrency = {
  currency_code?: string | null
  is_default?: boolean | null
}

export type CurrencyPlan =
  | { action: "leave" }
  | { action: "set-default-usd" }
  | {
      action: "add-usd"
      currencies: { currency_code: string; is_default: boolean }[]
    }

export type TaxRateShape = {
  id?: string
  code?: string | null
  rate?: number | null
  is_default?: boolean | null
}

export type IvaPlan =
  | { action: "noop"; reason: string }
  | { action: "add"; isDefault: boolean }

/**
 * Returns pp_system_default only when the region has no payment providers.
 * A configured provider, including a later PayPhone provider, is left alone.
 */
export function paymentProvidersForRegion(existingIds: string[]) {
  const ids = [...new Set(existingIds.filter((id) => Boolean(id)))]
  if (!ids.length) {
    return [SYSTEM_PAYMENT_PROVIDER_ID]
  }
  return null
}

/**
 * Currencies that are already configured are kept, including which one is
 * the default. USD is added only when the store has none of it yet.
 */
export function planStoreCurrencies(currencies: StoreCurrency[]): CurrencyPlan {
  const present = currencies.filter(
    (currency) => currency.currency_code?.trim()
  )
  if (!present.length) {
    return { action: "set-default-usd" }
  }

  const codes = present.map((currency) => currency.currency_code!.toLowerCase())
  if (codes.includes("usd")) {
    return { action: "leave" }
  }

  return {
    action: "add-usd",
    currencies: [
      ...present.map((currency) => ({
        currency_code: currency.currency_code!.toLowerCase(),
        is_default: Boolean(currency.is_default),
      })),
      { currency_code: "usd", is_default: false },
    ],
  }
}

/**
 * A default tax rate that is already set is not replaced. IVA 15% is added
 * beside it when missing. IVA becomes the default only on an empty tax region.
 */
export function planIva(rates: TaxRateShape[]): IvaPlan {
  const defaultRate = rates.find((rate) => rate.is_default)
  const hasIva = rates.some(
    (rate) =>
      (rate.code ?? "").toUpperCase() === "IVA" && Number(rate.rate) === 15
  )
  const defaultLabel = defaultRate?.code || defaultRate?.id || "existing"

  if (hasIva) {
    return {
      action: "noop",
      reason: defaultRate
        ? `default tax rate ${defaultLabel}`
        : "IVA 15%",
    }
  }

  if (defaultRate || rates.length) {
    return { action: "add", isDefault: false }
  }

  return { action: "add", isDefault: true }
}

export function namedStockLocation<T extends { name?: string | null }>(
  locations: T[],
  name = ECUADOR_STOCK_LOCATION_NAME
) {
  return locations.find((location) => location.name === name) ?? null
}
