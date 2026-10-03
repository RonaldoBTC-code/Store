import { MedusaError } from "@medusajs/framework/utils"

/** Dedicated database for BTCPay Postgres integration tests. Never the app database. */
export const BTCPAY_TEST_DATABASE_NAME = "btcpay_test"

/**
 * Connection string for the BTCPay integration tests.
 * `DATABASE_URL` is ignored. `127.0.0.1` (including `DB_HOST=127.0.0.1`)
 * is rewritten to `localhost` before the host and database-name guard.
 * The guard throws before the caller may DROP.
 */
export function btcpayTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BTCPAY_TEST_DATABASE_URL?.trim() ?? ""
  if (!configured) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "BTCPay Postgres integration tests need BTCPAY_TEST_DATABASE_URL."
    )
  }
  return assertBtcpayTestDatabaseAllowed(rewriteLoopbackHost(configured, env.DB_HOST))
}

/**
 * Throws unless the URL points at localhost and the dedicated test database.
 * Call this before any DROP.
 */
export function assertBtcpayTestDatabaseAllowed(connectionString: string): string {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to reset the BTCPay test database: the URL is invalid."
    )
  }

  const host = url.hostname === "127.0.0.1" ? "localhost" : url.hostname
  const database = databaseName(url)
  if (host !== "localhost") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to reset the BTCPay test database: host must be localhost."
    )
  }
  if (database !== BTCPAY_TEST_DATABASE_NAME) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to reset the BTCPay test database: database name must be btcpay_test."
    )
  }

  url.hostname = host
  return url.toString()
}

function rewriteLoopbackHost(connectionString: string, dbHost: string | undefined): string {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    return connectionString
  }
  const envHost = dbHost?.trim()
  if (url.hostname === "127.0.0.1" || (envHost === "127.0.0.1" && url.hostname === envHost)) {
    url.hostname = "localhost"
  }
  return url.toString()
}

function databaseName(url: URL): string {
  const path = url.pathname.replace(/^\//, "")
  return decodeURIComponent(path.split("/")[0] ?? "")
}
