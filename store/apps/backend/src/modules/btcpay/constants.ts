export const BTCPAY_IDENTIFIER = "btcpay"

/**
 * Medusa stores payment providers as `pp_{identifier}_{id}`.
 * `id` is the provider id in medusa-config.ts.
 */
export const BTCPAY_PROVIDER_ID = "pp_btcpay_btcpay"

/**
 * Medusa 2.21.0 resolves `/hooks/payment/{segment}` as `pp_{segment}`.
 * The `pp_` prefix on the URL is only accepted from Medusa 2.21.2 onward.
 */
export const BTCPAY_WEBHOOK_PATH = "/hooks/payment/btcpay_btcpay"

export const USD = "USD"

const REQUIRED_ENV = [
  "BTCPAY_URL",
  "BTCPAY_STORE_ID",
  "BTCPAY_API_KEY",
  "BTCPAY_WEBHOOK_SECRET",
] as const

export function isBtcpayConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return REQUIRED_ENV.every((key) => {
    const value = env[key]
    return typeof value === "string" && value.trim().length > 0
  })
}
