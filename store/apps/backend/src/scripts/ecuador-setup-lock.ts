import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { Client, type ClientConfig } from "pg"

/**
 * Session advisory lock for ensureEcuadorStore.
 *
 * Postgres `pg_advisory_lock(bigint)` takes one signed int8. This constant is
 * the only key Ecuador store setup uses, so every replica waits on the same
 * lock. It is a JS safe integer (below 2^53 - 1). Do not change it while a
 * process might still hold the previous key.
 */
export const ECUADOR_SETUP_LOCK_KEY = 7482910365542101

const LOCK_TIMEOUT_SQL = "SET lock_timeout = '5min'"
const LOCK_SQL = "SELECT pg_advisory_lock($1::bigint)"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint)"
const LOCK_BUSY_MESSAGE =
  "Otro proceso está configurando la tienda Ecuador; reintenta en unos minutos"

type ConfigWithDatabase = {
  projectConfig?: {
    databaseUrl?: string
  }
}

const databaseUrlFrom = (container: MedusaContainer) => {
  const config = container.resolve(
    ContainerRegistrationKeys.CONFIG_MODULE
  ) as ConfigWithDatabase
  const databaseUrl = config?.projectConfig?.databaseUrl
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A database URL is required to lock Ecuador store setup."
    )
  }
  return databaseUrl
}

// TODO: delete sslFor when this branch is rebased onto main after PR #8
// merges. Non-local hosts currently use rejectUnauthorized: false, which
// blocks DB and Security review. The lock Client must then use the already
// cleaned database URL and projectConfig.databaseDriverOptions.connection.ssl
// from PR #8's helper (store/apps/backend/src/utils/database-ssl.ts). Add a
// unit test that the Client constructor receives exactly that same ssl value.
const sslFor = (connectionString: string): ClientConfig["ssl"] => {
  let hostname = ""
  try {
    hostname = new URL(connectionString).hostname
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Database URL could not be read for the Ecuador store setup lock."
    )
  }
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    return false
  }
  return { rejectUnauthorized: false }
}

const lockConnectionError = () =>
  new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "Could not acquire the Ecuador store setup lock."
  )

const isLockNotAvailable = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "55P03"

/**
 * Holds a session advisory lock on a dedicated connection for the whole
 * callback. A second caller blocks in `pg_advisory_lock` until this
 * connection runs `pg_advisory_unlock`. Session `lock_timeout` is 5 minutes
 * (`SET`, not `SET LOCAL`) so a waiter fails with Postgres `55P03` instead
 * of waiting forever. The connection is closed in the same finally,
 * including when the callback throws. Connection strings are not logged
 * and are not copied into thrown errors.
 *
 * `pnpm seed:ec` and `pnpm migrate` must connect directly to Postgres or
 * through a pooler in session mode. This lock is session-scoped and does
 * not protect behind PgBouncer or the Supabase pooler in transaction mode
 * (port 6543).
 */
export async function withEcuadorSetupLock<T>(
  container: MedusaContainer,
  run: () => Promise<T>
): Promise<T> {
  const connectionString = databaseUrlFrom(container)
  const client = new Client({
    connectionString,
    ssl: sslFor(connectionString),
  })
  client.on("error", () => {
    // connect() and query() report failures. Do not log this event:
    // node-postgres can attach the connection string to the error.
  })

  let locked = false
  try {
    try {
      await client.connect()
      await client.query(LOCK_TIMEOUT_SQL)
      await client.query(LOCK_SQL, [String(ECUADOR_SETUP_LOCK_KEY)])
      locked = true
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          LOCK_BUSY_MESSAGE
        )
      }
      throw lockConnectionError()
    }
    return await run()
  } finally {
    try {
      if (locked) {
        await client.query(UNLOCK_SQL, [String(ECUADOR_SETUP_LOCK_KEY)])
      }
    } catch {
      // Closing the session releases the advisory lock.
    }
    try {
      await client.end()
    } catch {
      // The dedicated connection is already closed.
    }
  }
}
