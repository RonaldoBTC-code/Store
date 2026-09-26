import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { assertSeedAllowed } from "./assert-seed-allowed"
import {
  createApiKeysWorkflow,
  createPricePreferencesWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRatesWorkflow,
  createTaxRegionsWorkflow,
  updateTaxRatesWorkflow,
  deleteServiceZonesWorkflow,
  deleteShippingOptionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updatePricePreferencesWorkflow,
  updateRegionsWorkflow,
  updateShippingOptionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const COUNTRY_CODE = "ec"
const REGION_NAME = "Ecuador"
const CURRENCY_CODE = "usd"
const STORE_NAME = "Gato Gang"
const SALES_CHANNEL_NAME = "Default Sales Channel"
const PUBLISHABLE_KEY_TITLE = "Default Publishable API Key"
const PAYMENT_PROVIDER_ID = "pp_system_default"
const TAX_PROVIDER_ID = "tp_system"
const FULFILLMENT_PROVIDER_ID = "manual_manual"
const STOCK_LOCATION_NAME = "Ecuador"
const FULFILLMENT_SET_NAME = "Envíos Ecuador"
const SERVICE_ZONE_NAME = "Ecuador"
const SHIPPING_NAME = "Envío estándar"
const SHIPPING_LABEL = "Estándar"
const SHIPPING_DESCRIPTION = "Envío en 2-3 días."
const SHIPPING_CODE = "standard"
const SHIPPING_AMOUNT_USD = 10
const IVA_NAME = "IVA"
const IVA_CODE = "IVA"
const IVA_RATE = 15
const LEGACY_SHIPPING_NAMES = new Set([
  "Standard",
  "Standard Shipping",
  SHIPPING_NAME,
])

type IdRecord = { id: string }

type CountryRecord = { iso_2?: string | null }

type PaymentProviderRecord = { id?: string | null }

type RegionRecord = {
  id: string
  name?: string | null
  currency_code?: string | null
  countries?: CountryRecord[] | null
  payment_providers?: PaymentProviderRecord[] | null
}

type TaxRateRecord = {
  id: string
  code?: string | null
  name?: string | null
  rate?: number | null
  is_default?: boolean | null
}

type TaxRegionRecord = {
  id: string
  country_code?: string | null
  tax_rates?: TaxRateRecord[] | null
}

type StoreCurrencyRecord = {
  currency_code?: string | null
  is_default?: boolean | null
}

type StoreRecord = {
  id: string
  name?: string | null
  default_sales_channel_id?: string | null
  supported_currencies?: StoreCurrencyRecord[] | null
}

type SalesChannelRecord = {
  id: string
  name?: string | null
}

type ApiKeyRecord = {
  id: string
  title?: string | null
  type?: string | null
  sales_channels?: IdRecord[] | null
}

type GeoZoneRecord = { country_code?: string | null }

type ServiceZoneRecord = {
  id: string
  name?: string | null
  geo_zones?: GeoZoneRecord[] | null
}

type FulfillmentSetRecord = {
  id: string
  name?: string | null
  service_zones?: ServiceZoneRecord[] | null
}

type StockLocationRecord = {
  id: string
  name?: string | null
  address?: { country_code?: string | null } | null
  fulfillment_providers?: IdRecord[] | null
  fulfillment_sets?: FulfillmentSetRecord[] | null
  sales_channels?: IdRecord[] | null
}

type ShippingProfileRecord = { id: string; type?: string | null }

type ShippingOptionTypeRecord = {
  code?: string | null
  label?: string | null
  description?: string | null
}

type ShippingOptionRecord = {
  id: string
  name?: string | null
  service_zone_id?: string | null
  type?: ShippingOptionTypeRecord | null
}

type PricePreferenceRecord = {
  id: string
  attribute?: string | null
  value?: string | null
  is_tax_inclusive?: boolean | null
}

const countryCodesOf = (region: RegionRecord) =>
  (region.countries ?? [])
    .map((country) => country.iso_2?.toLowerCase())
    .filter((code): code is string => Boolean(code))

const zoneCountryCodes = (zone: ServiceZoneRecord) =>
  (zone.geo_zones ?? [])
    .map((geoZone) => geoZone.country_code?.toLowerCase())
    .filter((code): code is string => Boolean(code))

const zoneCoversEcuador = (zone: ServiceZoneRecord) =>
  zoneCountryCodes(zone).includes(COUNTRY_CODE) ||
  zone.name === SERVICE_ZONE_NAME

const zoneIsEcuadorOnly = (zone: ServiceZoneRecord) => {
  const codes = zoneCountryCodes(zone)
  return codes.length === 1 && codes[0] === COUNTRY_CODE
}

const isDuplicateLinkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /already exists|duplicate|multiple links|Cannot create multiple/i.test(
    message
  )
}

/**
 * Idempotent Ecuador store setup.
 *
 * Fresh databases get USD as the default currency, one Ecuador region,
 * IVA 15% as the default `ec` tax rate, tax-inclusive USD and region prices,
 * an Ecuador stock location with its own fulfillment set, and a Spanish
 * flat-rate shipping option at 10 USD. Re-running does not create European
 * regions or demo products, and does not duplicate records that already exist.
 */
export default async function ensureEcuadorStore({
  container,
}: {
  container: MedusaContainer
}) {
  assertSeedAllowed()

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  logger.info("Ensuring Ecuador store setup (USD, IVA 15%, tax-inclusive)...")

  const salesChannelId = await ensureSalesChannel(container, query, logger)
  await ensurePublishableKey(container, query, logger, salesChannelId)
  const storeId = await ensureStore(container, query, logger, salesChannelId)
  const region = await ensureRegion(container, query, logger)
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: storeId },
      update: { default_region_id: region.id },
    },
  })
  await ensureIva(container, query, logger)
  await ensureTaxInclusivePrices(container, query, logger, region.id)
  const shippingProfileId = await ensureShippingProfile(container, query, logger)
  const { locationId, serviceZoneId } = await ensureFulfillment(
    container,
    query,
    link,
    fulfillmentModule,
    logger
  )
  await ensureShippingOption(
    container,
    query,
    logger,
    serviceZoneId,
    shippingProfileId,
    region.id
  )
  await ensureLocationSalesChannel(
    container,
    query,
    logger,
    locationId,
    salesChannelId
  )
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: storeId },
      update: { default_location_id: locationId },
    },
  })

  logger.info(
    "Ecuador setup complete. Default currency USD, region ec, IVA 15% tax-inclusive, flat shipping 10 USD."
  )
}

async function ensureSalesChannel(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const channels = (data ?? []) as SalesChannelRecord[]
  const existing =
    channels.find((channel) => channel.name === SALES_CHANNEL_NAME) ??
    channels[0]

  if (existing) {
    logger.info(`Sales channel already exists (${existing.name}).`)
    return existing.id
  }

  const {
    result: [created],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: SALES_CHANNEL_NAME,
          description: "Gato Gang storefront",
        },
      ],
    },
  })
  logger.info(`Created sales channel ${SALES_CHANNEL_NAME}.`)
  return created.id
}

async function ensurePublishableKey(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  salesChannelId: string
) {
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "type", "sales_channels.id"],
  })
  const keys = (data ?? []) as ApiKeyRecord[]
  const publishable = keys.filter((key) => key.type === "publishable")
  const existing =
    publishable.find((key) => key.title === PUBLISHABLE_KEY_TITLE) ??
    publishable[0]

  let keyId = existing?.id
  if (!keyId) {
    const {
      result: [created],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: PUBLISHABLE_KEY_TITLE,
            type: "publishable",
            created_by: "",
          },
        ],
      },
    })
    keyId = created.id
    logger.info(`Created publishable API key ${keyId}.`)
  } else {
    logger.info(`Publishable API key already exists (${existing?.title}).`)
  }

  const linked = existing?.sales_channels?.some(
    (channel) => channel.id === salesChannelId
  )
  if (linked) {
    return
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: keyId,
      add: [salesChannelId],
    },
  })
  logger.info("Linked publishable API key to the sales channel.")
}

async function ensureStore(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  salesChannelId: string
) {
  const { data } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "name",
      "default_sales_channel_id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
  })
  const stores = (data ?? []) as StoreRecord[]
  const store = stores[0]

  if (!store) {
    const {
      result: [created],
    } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: STORE_NAME,
            supported_currencies: [
              { currency_code: CURRENCY_CODE, is_default: true },
            ],
            default_sales_channel_id: salesChannelId,
          },
        ],
      },
    })
    logger.info(`Created store ${STORE_NAME} with default currency USD.`)
    return created.id
  }

  const existingCodes = (store.supported_currencies ?? [])
    .map((currency) => currency.currency_code?.toLowerCase())
    .filter((code): code is string => Boolean(code) && code !== CURRENCY_CODE)
  const supported = [CURRENCY_CODE, ...existingCodes]

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id:
          store.default_sales_channel_id || salesChannelId,
        supported_currencies: supported.map((currency_code) => ({
          currency_code,
          is_default: currency_code === CURRENCY_CODE,
        })),
      },
    },
  })
  logger.info("Set USD as the store default currency.")
  return store.id
}

async function ensureRegion(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void; warn: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "region",
    fields: [
      "id",
      "name",
      "currency_code",
      "countries.iso_2",
      "payment_providers.id",
    ],
  })
  const regions = (data ?? []) as RegionRecord[]
  const byCountry = regions.find((region) =>
    countryCodesOf(region).includes(COUNTRY_CODE)
  )
  const byNameAndCurrency = regions.find(
    (region) =>
      region.name === REGION_NAME &&
      region.currency_code?.toLowerCase() === CURRENCY_CODE
  )
  const existing = byCountry ?? byNameAndCurrency

  if (!byCountry && byNameAndCurrency) {
    logger.info(
      `Reusing region "${REGION_NAME}" (${CURRENCY_CODE}) ${byNameAndCurrency.id} instead of creating another.`
    )
  }

  if (!existing) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: CURRENCY_CODE,
            countries: [COUNTRY_CODE],
            payment_providers: [PAYMENT_PROVIDER_ID],
          },
        ],
      },
    })
    logger.info(`Created region ${REGION_NAME} (${result[0].id}).`)
    return result[0]
  }

  const codes = countryCodesOf(existing)
  const dedicated = codes.length === 1 && codes[0] === COUNTRY_CODE
  if (!dedicated) {
    logger.warn(
      `Country ${COUNTRY_CODE} is on region "${existing.name}" together with other countries. Leaving that region unchanged.`
    )
    return existing
  }

  const providerIds = (existing.payment_providers ?? [])
    .map((provider) => provider.id)
    .filter((id): id is string => Boolean(id))
  const update: {
    name?: string
    currency_code?: string
    payment_providers?: string[]
  } = {}

  if (existing.name !== REGION_NAME) {
    update.name = REGION_NAME
  }
  if (existing.currency_code?.toLowerCase() !== CURRENCY_CODE) {
    update.currency_code = CURRENCY_CODE
  }
  if (!providerIds.includes(PAYMENT_PROVIDER_ID)) {
    update.payment_providers = [...providerIds, PAYMENT_PROVIDER_ID]
  }

  if (Object.keys(update).length) {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: existing.id },
        update,
      },
    })
    logger.info(`Updated Ecuador region ${existing.id}.`)
  } else {
    logger.info(`Ecuador region already exists (${existing.id}).`)
  }

  return existing
}

async function ensureIva(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "tax_region",
    fields: [
      "id",
      "country_code",
      "tax_rates.id",
      "tax_rates.code",
      "tax_rates.name",
      "tax_rates.rate",
      "tax_rates.is_default",
    ],
  })
  const taxRegions = (data ?? []) as TaxRegionRecord[]
  const existing = taxRegions.find(
    (taxRegion) => taxRegion.country_code?.toLowerCase() === COUNTRY_CODE
  )

  if (!existing) {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: COUNTRY_CODE,
          provider_id: TAX_PROVIDER_ID,
          default_tax_rate: {
            name: IVA_NAME,
            code: IVA_CODE,
            rate: IVA_RATE,
          },
        },
      ],
    })
    logger.info("Created Ecuador tax region with default IVA 15%.")
    return
  }

  const rates = existing.tax_rates ?? []
  const defaultRate = rates.find((rate) => rate.is_default) ?? rates[0]

  if (
    defaultRate &&
    defaultRate.code === IVA_CODE &&
    Number(defaultRate.rate) === IVA_RATE &&
    defaultRate.is_default
  ) {
    logger.info("Ecuador IVA 15% default tax rate already exists.")
    return
  }

  if (defaultRate) {
    await updateTaxRatesWorkflow(container).run({
      input: {
        selector: { id: defaultRate.id },
        update: {
          name: IVA_NAME,
          code: IVA_CODE,
          rate: IVA_RATE,
          is_default: true,
        },
      },
    })
    logger.info("Updated the Ecuador default tax rate to IVA 15%.")
    return
  }

  await createTaxRatesWorkflow(container).run({
    input: [
      {
        tax_region_id: existing.id,
        name: IVA_NAME,
        code: IVA_CODE,
        rate: IVA_RATE,
        is_default: true,
      },
    ],
  })
  logger.info("Added IVA 15% as the default tax rate for Ecuador.")
}

async function ensureTaxInclusivePrices(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  regionId: string
) {
  const { data } = await query.graph({
    entity: "price_preference",
    fields: ["id", "attribute", "value", "is_tax_inclusive"],
  })
  const preferences = (data ?? []) as PricePreferenceRecord[]

  await ensurePricePreference(
    container,
    logger,
    preferences,
    "currency_code",
    CURRENCY_CODE
  )
  await ensurePricePreference(
    container,
    logger,
    preferences,
    "region_id",
    regionId
  )
}

async function ensurePricePreference(
  container: MedusaContainer,
  logger: { info: (message: string) => void },
  preferences: PricePreferenceRecord[],
  attribute: string,
  value: string
) {
  const existing = preferences.find(
    (preference) =>
      preference.attribute === attribute && preference.value === value
  )

  if (!existing) {
    await createPricePreferencesWorkflow(container).run({
      input: [
        {
          attribute,
          value,
          is_tax_inclusive: true,
        },
      ],
    })
    logger.info(`Prices for ${attribute}=${value} are tax-inclusive.`)
    return
  }

  if (existing.is_tax_inclusive) {
    return
  }

  await updatePricePreferencesWorkflow(container).run({
    input: {
      selector: { id: [existing.id] },
      update: { is_tax_inclusive: true },
    },
  })
  logger.info(`Updated ${attribute}=${value} prices to tax-inclusive.`)
}

async function ensureShippingProfile(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "type"],
  })
  const profiles = (data ?? []) as ShippingProfileRecord[]
  const existing =
    profiles.find((profile) => profile.type === "default") ?? profiles[0]

  if (existing) {
    return existing.id
  }

  const { result } = await createShippingProfilesWorkflow(container).run({
    input: {
      data: [
        {
          name: "Default Shipping Profile",
          type: "default",
        },
      ],
    },
  })
  logger.info("Created the default shipping profile.")
  return result[0].id
}

async function ensureFulfillment(
  container: MedusaContainer,
  query: { graph: Function },
  link: { create: (data: object) => Promise<unknown> },
  fulfillmentModule: {
    createFulfillmentSets: (data: object) => Promise<FulfillmentSetRecord>
  },
  logger: { info: (message: string) => void; warn: (message: string) => void }
) {
  let location = await findEcuadorLocation(query)

  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: {
              address_1: "",
              country_code: COUNTRY_CODE,
            },
          },
        ],
      },
    })
    logger.info(`Created stock location ${STOCK_LOCATION_NAME}.`)
    location = {
      id: result[0].id,
      name: STOCK_LOCATION_NAME,
      fulfillment_sets: [],
      fulfillment_providers: [],
    }
  } else {
    logger.info(`Ecuador stock location already exists (${location.id}).`)
  }

  const providerLinked = location.fulfillment_providers?.some(
    (provider) => provider.id === FULFILLMENT_PROVIDER_ID
  )
  if (!providerLinked) {
    await createLink(link, logger, "fulfillment provider", {
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: FULFILLMENT_PROVIDER_ID,
      },
    })
  }

  await removeMisplacedEcuadorZones(container, query, logger, location.id)
  location = (await findEcuadorLocation(query)) ?? location

  const sets = location.fulfillment_sets ?? []
  let serviceZone = sets
    .flatMap((set) => set.service_zones ?? [])
    .find((zone) => zoneCoversEcuador(zone))

  if (!serviceZone) {
    const fulfillmentSet = sets[0]
    if (fulfillmentSet) {
      const { result } = await createServiceZonesWorkflow(container).run({
        input: {
          data: [
            {
              name: SERVICE_ZONE_NAME,
              fulfillment_set_id: fulfillmentSet.id,
              geo_zones: [
                {
                  type: "country",
                  country_code: COUNTRY_CODE,
                },
              ],
            },
          ],
        },
      })
      serviceZone = { id: result[0].id, name: SERVICE_ZONE_NAME }
      logger.info("Added the Ecuador service zone to its fulfillment set.")
    } else {
      const created = await fulfillmentModule.createFulfillmentSets({
        name: FULFILLMENT_SET_NAME,
        type: "shipping",
        service_zones: [
          {
            name: SERVICE_ZONE_NAME,
            geo_zones: [
              {
                country_code: COUNTRY_CODE,
                type: "country",
              },
            ],
          },
        ],
      })
      const fulfillmentSetCreated = Array.isArray(created) ? created[0] : created
      await createLink(link, logger, "fulfillment set", {
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: {
          fulfillment_set_id: fulfillmentSetCreated.id,
        },
      })
      serviceZone = fulfillmentSetCreated.service_zones?.[0]
      logger.info("Created the Ecuador fulfillment set and service zone.")
    }
  } else {
    logger.info(`Ecuador service zone already exists (${serviceZone.id}).`)
  }

  if (!serviceZone?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Ecuador service zone was not created."
    )
  }

  return { locationId: location.id, serviceZoneId: serviceZone.id }
}

async function findEcuadorLocation(query: { graph: Function }) {
  const { data } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "address.country_code",
      "fulfillment_providers.id",
      "fulfillment_sets.id",
      "fulfillment_sets.name",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.geo_zones.country_code",
      "sales_channels.id",
    ],
  })
  const locations = (data ?? []) as StockLocationRecord[]
  const byName = locations.find(
    (location) => location.name === STOCK_LOCATION_NAME
  )
  if (byName) {
    return byName
  }

  return locations.find(
    (location) =>
      location.address?.country_code?.toLowerCase() === COUNTRY_CODE
  )
}

async function removeMisplacedEcuadorZones(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void; warn: (message: string) => void },
  ecuadorLocationId: string
) {
  const { data } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.geo_zones.country_code",
    ],
  })
  const locations = (data ?? []) as StockLocationRecord[]
  const misplaced = locations
    .filter((location) => location.id !== ecuadorLocationId)
    .flatMap((location) => location.fulfillment_sets ?? [])
    .flatMap((set) => set.service_zones ?? [])
    .filter((zone) => zoneIsEcuadorOnly(zone))

  if (!misplaced.length) {
    return
  }

  const zoneIds = misplaced.map((zone) => zone.id)
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "service_zone_id"],
    filters: { service_zone_id: zoneIds },
  })
  const optionIds = ((options ?? []) as ShippingOptionRecord[]).map(
    (option) => option.id
  )

  if (optionIds.length) {
    await deleteShippingOptionsWorkflow(container).run({
      input: { ids: optionIds },
    })
  }

  await deleteServiceZonesWorkflow(container).run({
    input: { ids: zoneIds },
  })
  logger.info(
    "Removed Ecuador service zones that were attached to another stock location."
  )
}

async function ensureShippingOption(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  serviceZoneId: string,
  shippingProfileId: string,
  regionId: string
) {
  const { data } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "service_zone_id",
      "type.code",
      "type.label",
      "type.description",
    ],
  })
  const options = (data ?? []) as ShippingOptionRecord[]
  const onZone = options.filter(
    (option) => option.service_zone_id === serviceZoneId
  )
  const existing = onZone.find(
    (option) =>
      option.name === SHIPPING_NAME ||
      LEGACY_SHIPPING_NAMES.has(option.name ?? "") ||
      option.type?.code === SHIPPING_CODE
  )

  if (!existing) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: SHIPPING_NAME,
          price_type: "flat",
          provider_id: FULFILLMENT_PROVIDER_ID,
          service_zone_id: serviceZoneId,
          shipping_profile_id: shippingProfileId,
          type: {
            label: SHIPPING_LABEL,
            description: SHIPPING_DESCRIPTION,
            code: SHIPPING_CODE,
          },
          prices: [
            {
              currency_code: CURRENCY_CODE,
              amount: SHIPPING_AMOUNT_USD,
            },
            {
              region_id: regionId,
              amount: SHIPPING_AMOUNT_USD,
            },
          ],
          rules: [
            {
              attribute: "enabled_in_store",
              value: "true",
              operator: "eq",
            },
            {
              attribute: "is_return",
              value: "false",
              operator: "eq",
            },
          ],
        },
      ],
    })
    logger.info("Created Envío estándar at 10 USD.")
    return
  }

  const alreadySpanish =
    existing.name === SHIPPING_NAME &&
    existing.type?.label === SHIPPING_LABEL &&
    existing.type?.description === SHIPPING_DESCRIPTION

  if (alreadySpanish) {
    logger.info("Spanish standard shipping option already exists.")
    return
  }

  await updateShippingOptionsWorkflow(container).run({
    input: [
      {
        id: existing.id,
        name: SHIPPING_NAME,
        type: {
          label: SHIPPING_LABEL,
          description: SHIPPING_DESCRIPTION,
          code: SHIPPING_CODE,
        },
      },
    ],
  })
  logger.info("Updated the Ecuador shipping option to Spanish labels.")
}

async function ensureLocationSalesChannel(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  locationId: string,
  salesChannelId: string
) {
  const location = await findEcuadorLocation(query)
  const linked = location?.sales_channels?.some(
    (channel) => channel.id === salesChannelId
  )
  if (linked) {
    return
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: locationId,
      add: [salesChannelId],
    },
  })
  logger.info("Linked the Ecuador stock location to the sales channel.")
}

async function createLink(
  link: { create: (data: object) => Promise<unknown> },
  logger: { info: (message: string) => void },
  label: string,
  data: object
) {
  try {
    await link.create(data)
    logger.info(`Linked ${label}.`)
  } catch (error) {
    if (isDuplicateLinkError(error)) {
      logger.info(`Link already exists (${label}).`)
      return
    }
    throw error
  }
}
