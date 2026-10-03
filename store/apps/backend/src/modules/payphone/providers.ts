export const PAYPHONE_PROVIDER_ID = "pp_payphone_payphone"
export const SYSTEM_PROVIDER_ID = "pp_system_default"

type Env = {
  NODE_ENV?: string
  ALLOW_TEST_PAYMENTS?: string
}

/**
 * Manual checkout (`pp_system_default`) is available outside production.
 * `ALLOW_TEST_PAYMENTS=true` keeps it in production. `false` disables it
 * even in development.
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
