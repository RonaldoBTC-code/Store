import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

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
const RESET_LOCK_TIMEOUT_SQL = "RESET lock_timeout"
const LOCK_SQL = "SELECT pg_advisory_lock($1::bigint)"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint)"
const LOCK_BUSY_MESSAGE =
  "Otro proceso está configurando la tienda Ecuador; reintenta en unos minutos"

/**
 * Postgres and node error codes are short tokens (`55P03`, `28P01`,
 * `ECONNREFUSED`). Anything else can carry a connection string.
 */
const SAFE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/

type LockConnection = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>
}

type PgConnection = {
  client?: {
    acquireConnection?: () => Promise<LockConnection>
    releaseConnection?: (connection: LockConnection) => Promise<unknown>
  }
}

const causeCode = (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string" && SAFE_ERROR_CODE.test(code)) {
      return code
    }
  }
  const message = error instanceof Error ? error.message : ""
  if (/\bssl\b/i.test(message)) {
    return "SSL"
  }
  return ""
}

const lockConnectionError = (error: unknown) => {
  const code = causeCode(error)
  const detail = code ? ` (${code})` : ""
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `Could not acquire the Ecuador store setup lock${detail}.`
  )
}

const isLockNotAvailable = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "55P03"

/**
 * Holds a session advisory lock for the whole callback on one connection
 * taken from the app pool. `container.resolve(PG_CONNECTION).client` is the
 * same knex client Medusa 2.21 uses in `run-migration-scripts.ts`:
 * `acquireConnection()` then `releaseConnection()` in a finally. That
 * connection already has the app's SSL and CA settings, including whatever
 * `databaseDriverOptions.connection.ssl` the process was started with.
 *
 * Session `lock_timeout` is 5 minutes (`SET`, not `SET LOCAL`) so a waiter
 * fails with Postgres `55P03` instead of waiting forever. `RESET lock_timeout`
 * runs before the connection goes back to the pool. Connection strings are
 * not logged and are not copied into thrown errors. A failure includes only
 * a short cause code such as `ECONNREFUSED`, `28P01`, or `SSL`.
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
  const pgConnection = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as PgConnection
  const client = pgConnection?.client
  if (
    !client ||
    typeof client.acquireConnection !== "function" ||
    typeof client.releaseConnection !== "function"
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Could not acquire the Ecuador store setup lock (PG_CONNECTION)."
    )
  }

  let connection: LockConnection | undefined
  let locked = false
  let timeoutSet = false
  try {
    try {
      connection = await client.acquireConnection()
      await connection.query(LOCK_TIMEOUT_SQL)
      timeoutSet = true
      await connection.query(LOCK_SQL, [String(ECUADOR_SETUP_LOCK_KEY)])
      locked = true
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          LOCK_BUSY_MESSAGE
        )
      }
      throw lockConnectionError(error)
    }
    return await run()
  } finally {
    if (connection) {
      try {
        if (locked) {
          await connection.query(UNLOCK_SQL, [String(ECUADOR_SETUP_LOCK_KEY)])
        }
      } catch {
        // releaseConnection still runs. A dead session drops the lock.
      }
      try {
        if (timeoutSet) {
          await connection.query(RESET_LOCK_TIMEOUT_SQL)
        }
      } catch {
        // The pooled session must not keep the five-minute timeout.
      }
      try {
        await client.releaseConnection(connection)
      } catch {
        // The connection is already back in the pool.
      }
    }
  }
}
