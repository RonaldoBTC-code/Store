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

export const DEFAULT_SHIPPING_PROFILE_NAME = "Default Shipping Profile"

export type DefaultShippingProfileMatch<T> =
  | { status: "missing" }
  | { status: "one"; profile: T }
  | { status: "duplicate"; message: string }

/**
 * The default shipping profile is the one whose type is "default".
 * More than one is an error. Another type is not a substitute.
 */
export function matchDefaultShippingProfiles<
  T extends { id: string; type?: string | null },
>(profiles: T[]): DefaultShippingProfileMatch<T> {
  const matches = profiles.filter((profile) => profile.type === "default")
  if (matches.length > 1) {
    const ids = matches.map((profile) => profile.id).join(", ")
    return {
      status: "duplicate",
      message: `More than one shipping profile has type "default" (${ids}). Refusing to pick one.`,
    }
  }
  if (matches.length === 1) {
    return { status: "one", profile: matches[0] }
  }
  return { status: "missing" }
}

/**
 * Medusa has a unique index on shipping_profile.name. Creating the default
 * profile must stop when that name already belongs to a different type.
 */
export function defaultShippingProfileNameConflict<
  T extends { id: string; name?: string | null; type?: string | null },
>(profiles: T[], name = DEFAULT_SHIPPING_PROFILE_NAME): string | undefined {
  const named = profiles.find((profile) => profile.name === name)
  if (!named || named.type === "default") {
    return undefined
  }
  const shown = named.type?.trim() || "unset"
  return `A shipping profile named "${name}" already exists (${named.id}) with type "${shown}", not "default". Refusing to create another profile with that name or to change the existing one.`
}

export type EcuadorSetupDecision =
  | {
      status: "ready"
      salesChannelId: string | null
      shippingProfileId: string | null
    }
  | {
      status: "blocked"
      code: "invalid_data" | "not_allowed"
      message: string
    }

/**
 * Read-only decision for setup. A blocked result is thrown before any
 * workflow or module write. Shipping profile creation uses the ready ids.
 */
export function planEcuadorSetup(input: {
  salesChannels: { id: string; name?: string | null }[]
  shippingProfiles: { id: string; name?: string | null; type?: string | null }[]
  regions: {
    id: string
    name?: string | null
    currencyCode?: string | null
    countryCodes: string[]
  }[]
  salesChannelName: string
  regionName: string
  currencyCode: string
  countryCode: string
}): EcuadorSetupDecision {
  const channel = matchExactName(
    input.salesChannels,
    input.salesChannelName,
    "sales channel"
  )
  if (channel.status === "duplicate") {
    return { status: "blocked", code: "invalid_data", message: channel.message }
  }

  const profiles = matchDefaultShippingProfiles(input.shippingProfiles)
  if (profiles.status === "duplicate") {
    return {
      status: "blocked",
      code: "invalid_data",
      message: profiles.message,
    }
  }

  if (profiles.status === "missing") {
    const nameConflict = defaultShippingProfileNameConflict(input.shippingProfiles)
    if (nameConflict) {
      return { status: "blocked", code: "invalid_data", message: nameConflict }
    }
  }

  const countryCode = input.countryCode.toLowerCase()
  const currencyCode = input.currencyCode.toLowerCase()
  const byCountry = input.regions.find((region) =>
    region.countryCodes.some((code) => code.toLowerCase() === countryCode)
  )
  const byNameAndCurrency = input.regions.find(
    (region) =>
      region.name === input.regionName &&
      (region.currencyCode ?? "").toLowerCase() === currencyCode
  )
  const existing = byCountry ?? byNameAndCurrency
  if (existing) {
    const countryPlan = planRegionCountries({
      regionId: existing.id,
      regionName: existing.name,
      countryCodes: existing.countryCodes,
      otherRegions: input.regions
        .filter((region) => region.id !== existing.id)
        .map((region) => ({
          id: region.id,
          name: region.name,
          countryCodes: region.countryCodes,
        })),
      countryCode,
    })
    if (countryPlan.action === "stop") {
      return {
        status: "blocked",
        code: "not_allowed",
        message: countryPlan.message,
      }
    }
  }

  return {
    status: "ready",
    salesChannelId: channel.status === "one" ? channel.record.id : null,
    shippingProfileId: profiles.status === "one" ? profiles.profile.id : null,
  }
}

export function shouldFixEcuadorShippingProfile(
  env: { FIX_EC_SHIPPING_PROFILE?: string } = process.env
) {
  return env.FIX_EC_SHIPPING_PROFILE === "true"
}

/**
 * Cap products use the default shipping profile. An Ecuador option on
 * another profile is left unchanged unless FIX_EC_SHIPPING_PROFILE=true.
 */
export function ecuadorShippingProfileWarning(input: {
  optionName?: string | null
  optionId: string
  optionProfileId?: string | null
  defaultProfileId: string
}): string | undefined {
  if (input.optionProfileId === input.defaultProfileId) {
    return undefined
  }
  const name = input.optionName?.trim() || input.optionId
  const current = input.optionProfileId?.trim() || "unset"
  return `Shipping option "${name}" is on shipping profile ${current}, not the default profile ${input.defaultProfileId} used by cap products. Those products will not offer this option at checkout. Set FIX_EC_SHIPPING_PROFILE=true to move it onto the default profile. The option was left unchanged.`
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
