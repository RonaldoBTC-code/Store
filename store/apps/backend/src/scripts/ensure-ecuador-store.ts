import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  ecuadorReplacementIsReady,
  isCountryLevelEcuadorZone,
  shouldDeleteMisplacedEcuadorZones,
} from "./ecuador-zone-cleanup"
import { withEcuadorSetupLock } from "./ecuador-setup-lock"
import {
  chooseShippingFulfillmentSet,
  DEFAULT_SHIPPING_PROFILE_NAME,
  ecuadorShippingProfileWarning,
  namedStockLocation,
  paymentProvidersForRegion,
  planEcuadorSetup,
  productionFixFlagWarning,
  planIva,
  planRegionCountries,
  planStoreCurrencies,
  reusedRegionCurrencyWarning,
  shouldFixEcuadorShippingProfile,
  SYSTEM_PAYMENT_PROVIDER_ID,
} from "./ecuador-store-policy"
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
const PAYMENT_PROVIDER_ID = SYSTEM_PAYMENT_PROVIDER_ID
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
  default_region_id?: string | null
  default_location_id?: string | null
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

type GeoZoneRecord = {
  country_code?: string | null
  type?: string | null
  province_code?: string | null
  city?: string | null
  postal_expression?: unknown
}

type ServiceZoneRecord = {
  id: string
  name?: string | null
  geo_zones?: GeoZoneRecord[] | null
}

type FulfillmentSetRecord = {
  id: string
  name?: string | null
  type?: string | null
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

type ShippingProfileRecord = {
  id: string
  name?: string | null
  type?: string | null
}

type ShippingOptionTypeRecord = {
  code?: string | null
  label?: string | null
  description?: string | null
}

type ShippingOptionRecord = {
  id: string
  name?: string | null
  service_zone_id?: string | null
  shipping_profile_id?: string | null
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
 *
 * This runs from `pnpm seed:ec`, and from `medusa db:migrate` only while
 * `initial-data-seed.ts` has no `script_migrations.finished_at`. It is not
 * behind the product-seed guard, so that first production migrate can
 * create the base store. A later migrate skips the script. Product and
 * demo seeding stay gated separately. `FIX_EC_SHIPPING_PROFILE` is read
 * here as well. It is not covered by the local-host guard. Only the
 * explicit value `true` moves an option, and only on a run that actually
 * executes this setup.
 *
 * Blocking conflicts are read before any workflow runs: a duplicate
 * Default Sales Channel, more than one default shipping profile, a
 * Default Shipping Profile name used by another type, and a country `ec`
 * that cannot be attached. Those stops leave the database unchanged.
 *
 * The preflight and every write share one Postgres session advisory lock,
 * key 7482910365542101 (`ECUADOR_SETUP_LOCK_KEY`). It is acquired with
 * blocking `pg_advisory_lock` on a dedicated connection after session
 * `SET lock_timeout = '5min'`. Another caller waits until
 * `pg_advisory_unlock` runs, then reads the preflight again and keeps the
 * rows that already exist. Postgres `55P03` means the wait exceeded five
 * minutes. That connection is closed in the same finally, including when
 * setup throws. Connection strings are not logged. Medusa already
 * serializes migration scripts with `pg_try_advisory_lock` and skips a
 * script another process is running. This lock covers `pnpm seed:ec`
 * running in parallel with itself or with that first migrate. The sales
 * channel has no unique index. `pnpm seed:ec` and `pnpm migrate` must
 * connect directly to Postgres or through a pooler in session mode. The
 * lock is session-scoped and does not protect behind PgBouncer or the
 * Supabase pooler in transaction mode (port 6543).
 *
 * On a database that already has store defaults, currencies, or a default
 * tax rate, those values are left in place. An existing region keeps its
 * name and currency. Country ec is added when that region does not have it
 * and no other region does. pp_system_default is added only when the Ecuador
 * region has no payment provider yet. A default IVA rate other than 15% is
 * left in place and logged.
 *
 * Zone cleanup creates the Ecuador shipping option first, then deletes.
 * Those are separate workflows, so this is not one transaction. A failed
 * delete leaves the Ecuador option in place, and the next run continues
 * with whatever zones and options remain.
 */
type EcuadorLogger = {
  info: (message: string) => void
  warn: (message: string) => void
}

export default async function ensureEcuadorStore({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(
    ContainerRegistrationKeys.LOGGER
  ) as EcuadorLogger
  await withEcuadorSetupLock(container, () =>
    runEnsuredEcuadorStore(container, logger)
  )
}

async function runEnsuredEcuadorStore(
  container: MedusaContainer,
  logger: EcuadorLogger
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const flagWarning = productionFixFlagWarning()
  if (flagWarning) {
    logger.warn(flagWarning)
  }
  const setup = await preflightEcuadorStore(query)
  if (setup.status === "blocked") {
    throw new MedusaError(
      setup.code === "not_allowed"
        ? MedusaError.Types.NOT_ALLOWED
        : MedusaError.Types.INVALID_DATA,
      setup.message
    )
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  logger.info("Ensuring Ecuador store setup (USD, IVA 15%, tax-inclusive)...")

  const salesChannelId = await ensureSalesChannel(
    container,
    logger,
    setup.salesChannelId
  )
  await ensurePublishableKey(container, query, logger, salesChannelId)
  const storeId = await ensureStore(container, query, logger, salesChannelId)
  const region = await ensureRegion(container, query, logger)
  await assignStoreDefault(
    container,
    query,
    logger,
    storeId,
    "default_region_id",
    region.id
  )
  await ensureIva(container, query, logger)
  await ensureTaxInclusivePrices(container, query, logger, region.id)
  const shippingProfileId = await ensureShippingProfile(
    container,
    logger,
    setup.shippingProfileId
  )
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
  await removeMisplacedEcuadorZones(container, query, logger, {
    ecuadorLocationId: locationId,
    ecuadorServiceZoneId: serviceZoneId,
  })
  await ensureLocationSalesChannel(
    container,
    query,
    logger,
    locationId,
    salesChannelId
  )
  await assignStoreDefault(
    container,
    query,
    logger,
    storeId,
    "default_location_id",
    locationId
  )

  logger.info(
    "Ecuador setup complete. Default currency USD, region ec, IVA 15% tax-inclusive, flat shipping 10 USD."
  )
}

async function preflightEcuadorStore(query: { graph: Function }) {
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  return planEcuadorSetup({
    salesChannels: (channels ?? []) as SalesChannelRecord[],
    shippingProfiles: (profiles ?? []) as ShippingProfileRecord[],
    regions: ((regions ?? []) as RegionRecord[]).map((region) => ({
      id: region.id,
      name: region.name,
      currencyCode: region.currency_code,
      countryCodes: countryCodesOf(region),
    })),
    salesChannelName: SALES_CHANNEL_NAME,
    regionName: REGION_NAME,
    currencyCode: CURRENCY_CODE,
    countryCode: COUNTRY_CODE,
  })
}

async function ensureSalesChannel(
  container: MedusaContainer,
  logger: { info: (message: string) => void },
  salesChannelId: string | null
) {
  if (salesChannelId) {
    logger.info(`Sales channel already exists (${SALES_CHANNEL_NAME}).`)
    return salesChannelId
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
  const existing = keys.find(
    (key) => key.type === "publishable" && key.title === PUBLISHABLE_KEY_TITLE
  )

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
      "default_region_id",
      "default_location_id",
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

  const currencyPlan = planStoreCurrencies(store.supported_currencies ?? [])
  const update: {
    default_sales_channel_id?: string
    supported_currencies?: { currency_code: string; is_default: boolean }[]
  } = {}

  if (!store.default_sales_channel_id) {
    update.default_sales_channel_id = salesChannelId
  }

  if (currencyPlan.action === "set-default-usd") {
    update.supported_currencies = [
      { currency_code: CURRENCY_CODE, is_default: true },
    ]
  } else if (currencyPlan.action === "add-usd") {
    update.supported_currencies = currencyPlan.currencies
  } else {
    logger.info("Leaving store currencies unchanged.")
  }

  if (!Object.keys(update).length) {
    return store.id
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update,
    },
  })
  if (currencyPlan.action === "set-default-usd") {
    logger.info("Set USD as the store default currency.")
  }
  if (currencyPlan.action === "add-usd") {
    logger.info("Added USD without changing the existing default currency.")
  }
  return store.id
}

async function assignStoreDefault(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void },
  storeId: string,
  field: "default_region_id" | "default_location_id",
  value: string
) {
  const { data } = await query.graph({
    entity: "store",
    fields: ["id", field],
    filters: { id: storeId },
  })
  const store = ((data ?? []) as StoreRecord[])[0]
  const current = store?.[field]

  if (current) {
    logger.info(`Leaving ${field} unchanged (${current}).`)
    return
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: storeId },
      update: { [field]: value },
    },
  })
  logger.info(`Set ${field} to ${value}.`)
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
  const currencyWarning = reusedRegionCurrencyWarning({
    countryCodes: codes,
    currencyCode: existing.currency_code,
    regionName: existing.name,
    regionId: existing.id,
    countryCode: COUNTRY_CODE,
    expectedCurrency: CURRENCY_CODE,
  })
  if (currencyWarning) {
    logger.warn(currencyWarning)
  }

  const countryPlan = planRegionCountries({
    regionId: existing.id,
    regionName: existing.name,
    countryCodes: codes,
    otherRegions: regions
      .filter((region) => region.id !== existing.id)
      .map((region) => ({
        id: region.id,
        name: region.name,
        countryCodes: countryCodesOf(region),
      })),
    countryCode: COUNTRY_CODE,
  })

  if (countryPlan.action === "stop") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, countryPlan.message)
  }

  const providerIds = (existing.payment_providers ?? [])
    .map((provider) => provider.id)
    .filter((id): id is string => Boolean(id))
  const update: {
    countries?: string[]
    payment_providers?: string[]
  } = {}

  if (countryPlan.action === "add") {
    update.countries = countryPlan.countries
    logger.info(
      `Adding country ${COUNTRY_CODE} to region "${existing.name}" (${existing.id}) without renaming it or changing its currency.`
    )
  } else if (codes.length !== 1) {
    logger.info(
      `Region "${existing.name}" (${existing.id}) already includes country ${COUNTRY_CODE} along with other countries. Leaving its name, currency, and countries unchanged.`
    )
  }

  const providers = paymentProvidersForRegion(providerIds)
  if (providers) {
    update.payment_providers = providers
  } else {
    logger.info(
      `Leaving payment providers on region ${existing.id} unchanged (${providerIds.join(", ")}).`
    )
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
  logger: { info: (message: string) => void; warn: (message: string) => void }
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
  const ivaPlan = planIva(rates)

  if (ivaPlan.warning) {
    logger.warn(ivaPlan.warning)
  }

  if (ivaPlan.action === "noop") {
    logger.info(`Leaving the existing ${ivaPlan.reason} unchanged.`)
    return
  }

  await createTaxRatesWorkflow(container).run({
    input: [
      {
        tax_region_id: existing.id,
        name: IVA_NAME,
        code: IVA_CODE,
        rate: IVA_RATE,
        is_default: ivaPlan.isDefault,
      },
    ],
  })
  logger.info(
    ivaPlan.isDefault
      ? "Added IVA 15% as the default tax rate for Ecuador."
      : "Added IVA 15% without replacing the existing default tax rate."
  )
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
  logger: { info: (message: string) => void },
  shippingProfileId: string | null
) {
  if (shippingProfileId) {
    logger.info(`Default shipping profile already exists (${shippingProfileId}).`)
    return shippingProfileId
  }

  const { result } = await createShippingProfilesWorkflow(container).run({
    input: {
      data: [
        {
          name: DEFAULT_SHIPPING_PROFILE_NAME,
          type: "default",
        },
      ],
    },
  })
  const createdId = result[0]?.id
  if (!createdId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      'No shipping profile with type "default" exists, and creating one failed.'
    )
  }
  logger.info("Created the default shipping profile.")
  return createdId
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
    const createdId = result[0]?.id
    if (!createdId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "No stock location named Ecuador exists, and creating one failed. Refusing to use another location with an ec address."
      )
    }
    logger.info(`Created stock location ${STOCK_LOCATION_NAME}.`)
    location = {
      id: createdId,
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

  location = (await findEcuadorLocation(query)) ?? location

  const sets = location.fulfillment_sets ?? []
  let serviceZone = sets
    .flatMap((set) => set.service_zones ?? [])
    .find((zone) => isCountryLevelEcuadorZone(zone))

  if (!serviceZone) {
    const fulfillmentSet = chooseShippingFulfillmentSet(sets)
    if (!fulfillmentSet && sets.length) {
      logger.info(
        "No shipping fulfillment set named Envíos Ecuador. Creating one instead of using a pickup set."
      )
    }
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
      "fulfillment_sets.type",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.geo_zones.type",
      "fulfillment_sets.service_zones.geo_zones.country_code",
      "fulfillment_sets.service_zones.geo_zones.province_code",
      "fulfillment_sets.service_zones.geo_zones.city",
      "fulfillment_sets.service_zones.geo_zones.postal_expression",
      "sales_channels.id",
    ],
  })
  const locations = (data ?? []) as StockLocationRecord[]
  return namedStockLocation(locations, STOCK_LOCATION_NAME)
}

async function removeMisplacedEcuadorZones(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void; warn: (message: string) => void },
  input: {
    ecuadorLocationId: string
    ecuadorServiceZoneId: string
  }
) {
  const { data } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.geo_zones.type",
      "fulfillment_sets.service_zones.geo_zones.country_code",
      "fulfillment_sets.service_zones.geo_zones.province_code",
      "fulfillment_sets.service_zones.geo_zones.city",
      "fulfillment_sets.service_zones.geo_zones.postal_expression",
    ],
  })
  const locations = (data ?? []) as StockLocationRecord[]
  const ecuador = locations.find(
    (location) => location.id === input.ecuadorLocationId
  )
  const ecuadorZone = (ecuador?.fulfillment_sets ?? [])
    .flatMap((set) => set.service_zones ?? [])
    .find((zone) => zone.id === input.ecuadorServiceZoneId)
  const misplaced = locations
    .filter((location) => location.id !== input.ecuadorLocationId)
    .flatMap((location) => location.fulfillment_sets ?? [])
    .flatMap((set) => set.service_zones ?? [])
    .filter((zone) => isCountryLevelEcuadorZone(zone))

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
  const { data: ecuadorOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "service_zone_id"],
    filters: { service_zone_id: input.ecuadorServiceZoneId },
  })
  const ecuadorOptionIds = ((ecuadorOptions ?? []) as ShippingOptionRecord[])
    .map((option) => option.id)
    .filter((id) => Boolean(id))
  const idLog = `service zone ids: ${zoneIds.join(", ")}; shipping option ids: ${optionIds.join(", ") || "none"}`

  if (
    !ecuadorReplacementIsReady({
      hasCountryZone: Boolean(
        ecuadorZone && isCountryLevelEcuadorZone(ecuadorZone)
      ),
      shippingOptionIds: ecuadorOptionIds,
    })
  ) {
    logger.warn(
      `Skipping zone cleanup because the Ecuador stock location does not yet have a country-level zone and shipping option. ${idLog}.`
    )
    return
  }

  if (!shouldDeleteMisplacedEcuadorZones()) {
    logger.warn(
      `Dry run: would delete country-level Ecuador zones on another stock location. ${idLog}. Set FIX_EC_ZONES=true to delete them.`
    )
    return
  }

  try {
    if (optionIds.length) {
      await deleteShippingOptionsWorkflow(container).run({
        input: { ids: optionIds },
      })
    }

    await deleteServiceZonesWorkflow(container).run({
      input: { ids: zoneIds },
    })
    logger.info(`Deleted misplaced Ecuador zones. ${idLog}.`)
  } catch (error) {
    logger.warn(
      [
        "Zone cleanup stopped. Each delete workflow commits on its own, so this was not rolled back as one transaction.",
        `Ecuador shipping option ids ${ecuadorOptionIds.join(", ") || "none"} were created first and were not part of the delete.`,
        `Re-run the setup to continue. ${idLog}.`,
      ].join(" ")
    )
    throw error
  }
}

async function ensureShippingOption(
  container: MedusaContainer,
  query: { graph: Function },
  logger: { info: (message: string) => void; warn: (message: string) => void },
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
      "shipping_profile_id",
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
  const profileWarning = ecuadorShippingProfileWarning({
    optionName: existing.name,
    optionId: existing.id,
    optionProfileId: existing.shipping_profile_id,
    defaultProfileId: shippingProfileId,
  })
  const fixProfile = Boolean(profileWarning) && shouldFixEcuadorShippingProfile()

  if (profileWarning && !fixProfile) {
    logger.warn(profileWarning)
  }

  if (alreadySpanish && !fixProfile) {
    logger.info("Spanish standard shipping option already exists.")
    return
  }

  await updateShippingOptionsWorkflow(container).run({
    input: [
      {
        id: existing.id,
        ...(alreadySpanish
          ? {}
          : {
              name: SHIPPING_NAME,
              type: {
                label: SHIPPING_LABEL,
                description: SHIPPING_DESCRIPTION,
                code: SHIPPING_CODE,
              },
            }),
        ...(fixProfile ? { shipping_profile_id: shippingProfileId } : {}),
      },
    ],
  })
  if (fixProfile && alreadySpanish) {
    logger.info(
      `Moved shipping option "${existing.name ?? existing.id}" onto the default shipping profile.`
    )
    return
  }
  logger.info(
    fixProfile
      ? "Updated the Ecuador shipping option to Spanish labels and the default shipping profile."
      : "Updated the Ecuador shipping option to Spanish labels."
  )
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
