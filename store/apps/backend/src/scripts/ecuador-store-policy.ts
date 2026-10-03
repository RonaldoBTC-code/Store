export const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"
export const ECUADOR_STOCK_LOCATION_NAME = "Ecuador"
export const ECUADOR_FULFILLMENT_SET_NAME = "Envíos Ecuador"
export const ECUADOR_COUNTRY_CODE = "ec"

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
  | { action: "noop"; reason: string; warning?: string }
  | { action: "add"; isDefault: boolean; warning?: string }

export type RegionCountryPlan =
  | { action: "keep" }
  | { action: "add"; countries: string[] }
  | { action: "stop"; message: string }

export type FulfillmentSetChoice = {
  name?: string | null
  type?: string | null
}

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
const defaultIvaWarning = (rate: TaxRateShape | undefined) => {
  if (!rate?.is_default) {
    return undefined
  }
  if ((rate.code ?? "").toUpperCase() !== "IVA") {
    return undefined
  }
  if (Number(rate.rate) === 15) {
    return undefined
  }
  const shown =
    rate.rate == null || Number.isNaN(Number(rate.rate))
      ? "unset"
      : `${Number(rate.rate)}%`
  return `Default IVA rate is ${shown}, not 15%. Leaving that default unchanged.`
}

export function planIva(rates: TaxRateShape[]): IvaPlan {
  const defaultRate = rates.find((rate) => rate.is_default)
  const hasIva = rates.some(
    (rate) =>
      (rate.code ?? "").toUpperCase() === "IVA" && Number(rate.rate) === 15
  )
  const defaultLabel = defaultRate?.code || defaultRate?.id || "existing"
  const warning = defaultIvaWarning(defaultRate)

  if (hasIva) {
    return {
      action: "noop",
      reason: defaultRate
        ? `default tax rate ${defaultLabel}`
        : "IVA 15%",
      ...(warning ? { warning } : {}),
    }
  }

  if (defaultRate || rates.length) {
    return {
      action: "add",
      isDefault: false,
      ...(warning ? { warning } : {}),
    }
  }

  return { action: "add", isDefault: true }
}

/**
 * An existing region keeps its name and currency. Country ec is added only
 * when this region does not already have it and no other region does either.
 */
export function planRegionCountries(input: {
  regionId: string
  regionName?: string | null
  countryCodes: string[]
  otherRegions: {
    id: string
    name?: string | null
    countryCodes: string[]
  }[]
  countryCode?: string
}): RegionCountryPlan {
  const countryCode = (input.countryCode ?? ECUADOR_COUNTRY_CODE).toLowerCase()
  const codes = input.countryCodes
    .map((code) => code.toLowerCase())
    .filter((code) => Boolean(code))

  if (codes.includes(countryCode)) {
    return { action: "keep" }
  }

  const holder = input.otherRegions.find((region) =>
    region.countryCodes.some((code) => code.toLowerCase() === countryCode)
  )
  if (holder) {
    return {
      action: "stop",
      message: `Country ${countryCode} is already on region "${holder.name ?? holder.id}" (${holder.id}). Refusing to attach it to "${input.regionName ?? input.regionId}" (${input.regionId}).`,
    }
  }

  return { action: "add", countries: [...codes, countryCode] }
}

/**
 * A new Ecuador service zone goes on the shipping set named Envíos Ecuador,
 * or otherwise on a set whose type is shipping. Pickup sets are never used.
 */
export function chooseShippingFulfillmentSet<T extends FulfillmentSetChoice>(
  sets: T[],
  name = ECUADOR_FULFILLMENT_SET_NAME
): T | null {
  const candidates = sets.filter(
    (set) => (set.type ?? "").toLowerCase() !== "pickup"
  )
  return (
    candidates.find((set) => set.name === name) ??
    candidates.find((set) => (set.type ?? "").toLowerCase() === "shipping") ??
    null
  )
}

export type ExactNameMatch<T> =
  | { status: "missing" }
  | { status: "one"; record: T }
  | { status: "duplicate"; message: string }

/**
 * Matches a record by exact name. More than one match is an error so the
 * caller does not silently use the first.
 */
export function matchExactName<T extends { id: string; name?: string | null }>(
  records: T[],
  name: string,
  label = "record"
): ExactNameMatch<T> {
  const matches = records.filter((record) => record.name === name)
  if (matches.length > 1) {
    const ids = matches.map((record) => record.id).join(", ")
    return {
      status: "duplicate",
      message: `More than one ${label} is named "${name}" (${ids}). Refusing to pick one.`,
    }
  }
  if (matches.length === 1) {
    return { status: "one", record: matches[0] }
  }
  return { status: "missing" }
}

/**
 * The default shipping profile is the one whose type is "default".
 * Another profile is not a substitute.
 */
export function findDefaultShippingProfile<
  T extends { type?: string | null },
>(profiles: T[]): T | null {
  return profiles.find((profile) => profile.type === "default") ?? null
}

/**
 * A region that already includes ec is reused even when its currency is
 * not USD. The caller logs the warning and does not change the currency.
 */
export function reusedRegionCurrencyWarning(input: {
  countryCodes: string[]
  currencyCode?: string | null
  regionName?: string | null
  regionId: string
  countryCode?: string
  expectedCurrency?: string
}): string | undefined {
  const countryCode = (input.countryCode ?? ECUADOR_COUNTRY_CODE).toLowerCase()
  const expected = (input.expectedCurrency ?? "usd").toLowerCase()
  const codes = input.countryCodes.map((code) => code.toLowerCase())
  if (!codes.includes(countryCode)) {
    return undefined
  }
  const currency = input.currencyCode?.trim().toLowerCase()
  if (currency === expected) {
    return undefined
  }
  const shown = input.currencyCode?.trim() || "unset"
  const name = input.regionName?.trim() || input.regionId
  return `Region "${name}" (${input.regionId}) already includes country ${countryCode} but its currency is ${shown}, not ${expected}. Reusing it without changing the currency.`
}

export function namedStockLocation<T extends { name?: string | null }>(
  locations: T[],
  name = ECUADOR_STOCK_LOCATION_NAME
) {
  return locations.find((location) => location.name === name) ?? null
}
