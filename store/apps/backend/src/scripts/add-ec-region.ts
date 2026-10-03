import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const COUNTRY_CODE = "ec"
const REGION_NAME = "Ecuador"
const CURRENCY_CODE = "usd"
const SERVICE_ZONE_NAME = "Ecuador"
const SHIPPING_OPTION_NAME = "Standard"
const SHIPPING_AMOUNT_USD = 10

type RegionRecord = {
  id: string
  name?: string
  countries?: { iso_2?: string | null }[]
}

type TaxRegionRecord = {
  id: string
  country_code?: string | null
}

type StoreCurrencyRecord = {
  currency_code?: string | null
}

type StoreRecord = {
  id: string
  supported_currencies?: StoreCurrencyRecord[]
}

type GeoZoneRecord = {
  country_code?: string | null
}

type ServiceZoneRecord = {
  id: string
  name?: string
  geo_zones?: GeoZoneRecord[]
}

type FulfillmentSetRecord = {
  id: string
  name?: string
  service_zones?: ServiceZoneRecord[]
}

type ShippingOptionRecord = {
  id: string
  name?: string
  service_zone_id?: string
}

type ShippingProfileRecord = {
  id: string
}

/**
 * Creates the Ecuador USD region, tax region, store default currency, and Standard shipping.
 * The script is idempotent: existing `ec` records are reused instead of duplicated.
 */
export default async function addEcRegion({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("Ensuring Ecuador region, tax region, USD default, and shipping...")

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  const existingEcRegion = (regions as RegionRecord[]).find((region) =>
    region.countries?.some((country) => country.iso_2 === COUNTRY_CODE)
  )

  let regionId: string

  if (existingEcRegion) {
    logger.info(
      `Region with country ${COUNTRY_CODE} already exists (${existingEcRegion.name}). Skipping create.`
    )
    regionId = existingEcRegion.id
  } else {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: CURRENCY_CODE,
            countries: [COUNTRY_CODE],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    regionId = result[0].id
    logger.info(`Created region ${REGION_NAME} (${regionId}).`)
  }

  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
  })

  const hasEcTaxRegion = (taxRegions as TaxRegionRecord[]).some(
    (taxRegion) => taxRegion.country_code === COUNTRY_CODE
  )

  if (hasEcTaxRegion) {
    logger.info(`Tax region for ${COUNTRY_CODE} already exists. Skipping create.`)
  } else {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: COUNTRY_CODE,
          provider_id: "tp_system",
        },
      ],
    })
    logger.info(`Created tax region for ${COUNTRY_CODE}.`)
  }

  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "supported_currencies.currency_code"],
  })

  const store = (stores as StoreRecord[])[0]
  if (!store) {
    throw new Error("No store found. Seed the database first.")
  }

  const secondaryCurrencies = (store.supported_currencies ?? [])
    .map((currency) => currency.currency_code)
    .filter((code): code is string => Boolean(code) && code !== CURRENCY_CODE)

  if (!secondaryCurrencies.includes("eur")) {
    secondaryCurrencies.push("eur")
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_region_id: regionId,
        supported_currencies: [
          {
            currency_code: CURRENCY_CODE,
            is_default: true,
          },
          ...secondaryCurrencies.map((currency_code) => ({
            currency_code,
            is_default: false,
          })),
        ],
      },
    },
  })
  logger.info("Set USD as the store default currency (EUR remains secondary).")

  const { data: fulfillmentSets } = await query.graph({
    entity: "fulfillment_set",
    fields: [
      "id",
      "name",
      "service_zones.id",
      "service_zones.name",
      "service_zones.geo_zones.country_code",
    ],
  })

  const fulfillmentSet = (fulfillmentSets as FulfillmentSetRecord[])[0]
  if (!fulfillmentSet) {
    throw new Error("No fulfillment set found. Seed the database first.")
  }

  const existingServiceZone = fulfillmentSet.service_zones?.find(
    (zone) =>
      zone.name === SERVICE_ZONE_NAME ||
      zone.geo_zones?.some((geoZone) => geoZone.country_code === COUNTRY_CODE)
  )

  let serviceZoneId: string

  if (existingServiceZone) {
    logger.info(
      `Service zone for Ecuador already exists (${existingServiceZone.name}). Skipping create.`
    )
    serviceZoneId = existingServiceZone.id
  } else {
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
    serviceZoneId = result[0].id
    logger.info(`Created service zone ${SERVICE_ZONE_NAME}.`)
  }

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfile = (shippingProfiles as ShippingProfileRecord[])[0]
  if (!shippingProfile) {
    throw new Error("No shipping profile found. Seed the database first.")
  }

  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "service_zone_id"],
  })

  const hasStandardOption = (shippingOptions as ShippingOptionRecord[]).some(
    (option) =>
      option.service_zone_id === serviceZoneId &&
      (option.name === SHIPPING_OPTION_NAME ||
        option.name === "Standard Shipping")
  )

  if (hasStandardOption) {
    logger.info("Standard shipping option for Ecuador already exists. Skipping create.")
  } else {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: SHIPPING_OPTION_NAME,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: serviceZoneId,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Standard",
            description: "Ship in 2-3 days.",
            code: "standard",
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
    logger.info("Created Standard shipping option for Ecuador at 10 USD.")
  }

  logger.info("Ecuador USD setup complete.")
}
