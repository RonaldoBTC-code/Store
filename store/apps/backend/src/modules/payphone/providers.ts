export const PAYPHONE_PROVIDER_ID = "pp_payphone_payphone"
export const SYSTEM_PROVIDER_ID = "pp_system_default"

type Env = {
  NODE_ENV?: string
  ALLOW_TEST_PAYMENTS?: string
}

/**
 * Manual checkout (`pp_system_default`) is the dev and CI end-to-end path.
 * `NODE_ENV` of `development` or `test` keeps it. Production hides it.
 * `ALLOW_TEST_PAYMENTS=true` keeps it in production. That is never for
 * production: it marks an order paid without a charge. `false` disables it
 * even in development and CI.
 */
export function testPaymentsAllowed(env: Env = process.env): boolean {
  if (env.ALLOW_TEST_PAYMENTS === "true") {
    return true
  }

  if (env.ALLOW_TEST_PAYMENTS === "false") {
    return false
  }

  return env.NODE_ENV !== "production"
}

export function regionPaymentProviders(env: Env = process.env): string[] {
  const providers = [PAYPHONE_PROVIDER_ID]

  if (testPaymentsAllowed(env)) {
    providers.push(SYSTEM_PROVIDER_ID)
  }

  return providers
}

const TEST_PAYMENTS_PRODUCTION_WARNING =
  "WARNING: ALLOW_TEST_PAYMENTS=true while NODE_ENV=production. Manual test checkout is enabled and can mark an order paid without a charge. ALLOW_TEST_PAYMENTS is never for production."

/**
 * Logs once per call. The module loader calls this on every process start.
 */
export function warnTestPaymentsInProduction(
  logger: { warn?: (message: string) => void } | undefined,
  env: Env = process.env
) {
  if (env.NODE_ENV === "production" && env.ALLOW_TEST_PAYMENTS === "true") {
    logger?.warn?.(TEST_PAYMENTS_PRODUCTION_WARNING)
  }
}
