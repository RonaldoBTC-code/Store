import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import {
  BTCPAY_PROVIDER_ID,
  isBtcpayConfigured,
} from "../modules/btcpay/constants"

const COUNTRY_CODE = "ec"

type RegionRecord = {
  id: string
  payment_providers?: { id?: string | null }[] | null
  countries?: { iso_2?: string | null }[] | null
}

/**
 * Appends the BTCPay provider to the existing Ecuador region.
 * Region creation stays in the Ecuador seed. This script does nothing
 * unless the four BTCPay environment variables are set.
 */
export default async function enableBtcpayOnEc({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!isBtcpayConfigured()) {
    logger.info("BTCPay is not configured. Ecuador region was left unchanged.")
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "region",
    fields: ["id", "payment_providers.id", "countries.iso_2"],
  })

  const region = (data as RegionRecord[]).find((entry) =>
    entry.countries?.some((country) => country.iso_2 === COUNTRY_CODE)
  )
  if (!region) {
    logger.info("No Ecuador region exists yet. BTCPay was not attached.")
    return
  }

  const providers = (region.payment_providers ?? [])
    .map((provider) => provider.id)
    .filter((id): id is string => Boolean(id))

  if (providers.includes(BTCPAY_PROVIDER_ID)) {
    logger.info("BTCPay is already enabled for the Ecuador region.")
    return
  }

  await updateRegionsWorkflow(container).run({
    input: {
      selector: { id: region.id },
      update: {
        payment_providers: [...providers, BTCPAY_PROVIDER_ID],
      },
    },
  })
  logger.info("Enabled BTCPay for the Ecuador region.")
}
