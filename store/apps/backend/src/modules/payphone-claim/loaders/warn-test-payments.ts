import {
  assertManualProviderAllowedAtStartup,
  regionPaymentProviders,
  warnTestPaymentsInProduction,
} from "../../payphone/providers"

/**
 * Runs when the claim module loads, which is every backend start.
 */
export default async function warnTestPaymentsLoader({
  logger,
}: {
  logger?: { warn?: (message: string) => void }
}) {
  assertManualProviderAllowedAtStartup(regionPaymentProviders())
  warnTestPaymentsInProduction(logger)
}
