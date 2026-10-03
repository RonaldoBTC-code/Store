import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { regionPaymentProviders } from "../modules/payphone/providers"

const COUNTRY_CODE = "ec"

type RegionRecord = {
  id: string
  name?: string
  countries?: { iso_2?: string | null }[]
  payment_providers?: { id?: string | null }[]
}

/**
 * Idempotently sets the Ecuador region's payment providers.
 * PayPhone is always included. pp_system_default is included only when test
 * payments are allowed (see regionPaymentProviders).
 *
 * Run from apps/backend:
 * npx medusa exec ./src/scripts/register-ec-payment-providers.ts
 */
export default async function registerEcPaymentProviders({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const desired = regionPaymentProviders()

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "countries.iso_2", "payment_providers.id"],
  })
  const region = (regions as RegionRecord[]).find((entry) =>
    entry.countries?.some((country) => country.iso_2 === COUNTRY_CODE)
  )

  if (!region) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No Ecuador region found. Create it first (src/scripts/add-ec-region.ts), then rerun this script."
    )
  }

  const current = (region.payment_providers ?? [])
    .map((provider) => provider.id)
    .filter((id): id is string => Boolean(id))
    .sort()
  const next = [...desired].sort()

  if (current.join(",") === next.join(",")) {
    logger.info(
      `Ecuador region already uses payment providers: ${next.join(", ")}.`
    )
    return
  }

  await updateRegionsWorkflow(container).run({
    input: {
      selector: { id: region.id },
      update: {
        payment_providers: desired,
      },
    },
  })

  logger.info(
    `Updated Ecuador payment providers from [${current.join(", ")}] to [${next.join(", ")}].`
  )
}
