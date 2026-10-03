import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * Session advisory lock for ensureEcuadorStore.
 *
 * Postgres `pg_try_advisory_lock(bigint)` takes one signed int8. This
 * constant is the only key Ecuador store setup uses, so every replica
 * waits on the same lock. It is a JS safe integer (below 2^53 - 1). Do
 * not change it while a process might still hold the previous key.
 */
export const ECUADOR_SETUP_LOCK_KEY = 7482910365542101

/** Waiters give up after five minutes and leave the pool connection free. */
export const ECUADOR_SETUP_LOCK_LIMIT_MS = 5 * 60 * 1000

const TRY_LOCK_SQL = "SELECT pg_try_advisory_lock($1::bigint) AS acquired"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint) AS unlocked"
const LOCK_BUSY_MESSAGE =
  "Otro proceso está configurando la tienda Ecuador; reintenta en unos minutos"

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

/**
 * Postgres and node error codes are short tokens (`28P01`, `ECONNREFUSED`).
 * Anything else can carry a connection string.
 */
const SAFE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/

type LockConnection = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>
  __knex__disposed?: unknown
}

type PgClient = {
  acquireConnection: () => Promise<LockConnection>
  releaseConnection: (connection: LockConnection) => Promise<unknown>
  /**
   * Knex 3.2.10 postgres dialect: `connection.end()`. Tarn's `pool.release`
   * does not validate; it pushes the resource onto the free list. The next
   * acquire runs knex `validate`, which returns false when `__knex__disposed`
   * is set, and tarn then calls this destroyer. Ending the socket here drops
   * the session advisory lock before that later checkout.
   */
  destroyRawConnection?: (connection: LockConnection) => Promise<unknown>
}

type PgConnection = {
  client?: Partial<PgClient>
}

export type EcuadorSetupLockDeps = {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

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

const booleanColumn = (result: unknown, column: string) => {
  if (!result || typeof result !== "object" || !("rows" in result)) {
    return false
  }
  const rows = (result as { rows?: unknown }).rows
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== "object") {
    return false
  }
  const value = (rows[0] as Record<string, unknown>)[column]
  return value === true || value === "t"
}

const delayMs = (attempt: number) => {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  const jitter = Math.floor(Math.random() * 1000)
  return exponential + jitter
}

const releaseQuiet = async (client: PgClient, connection: LockConnection) => {
  try {
    await client.releaseConnection(connection)
  } catch {
    // The pool already dropped the connection.
  }
}

const destroyHeldConnection = async (
  client: PgClient,
  connection: LockConnection
) => {
  connection.__knex__disposed = true
  if (typeof client.destroyRawConnection === "function") {
    try {
      await client.destroyRawConnection(connection)
    } catch {
      // The socket is already closed. Postgres drops the session lock.
    }
  }
  await releaseQuiet(client, connection)
}

/**
 * Holds a session advisory lock for the whole callback on one connection
 * taken from the app pool. `container.resolve(PG_CONNECTION).client` is the
 * same knex client Medusa 2.21 uses in `run-migration-scripts.ts`.
 *
 * Each attempt calls `pg_try_advisory_lock`. A false result returns that
 * connection to the pool, waits a few seconds with jitter, and tries again
 * until five minutes have passed. Only the holder keeps a connection.
 * Connection strings are not logged.
 *
 * The holder's `finally` runs `pg_advisory_unlock` first. A true result is
 * `releaseConnection`. A throw or a false result ends the session with
 * `destroyRawConnection` after `__knex__disposed` is set, then releases the
 * pool slot so tarn will not hand the socket out again.
 *
 * `pnpm seed:ec` and `pnpm migrate` must connect directly to Postgres or
 * through a pooler in session mode. This lock is session-scoped and does
 * not protect behind PgBouncer or the Supabase pooler in transaction mode
 * (port 6543). Real certificate verification for the pool arrives with PR
 * #8. Merge order is #10, then #8, then #6.
 */
export async function withEcuadorSetupLock<T>(
  container: MedusaContainer,
  run: () => Promise<T>,
  deps: EcuadorSetupLockDeps = {}
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
  const pgClient = client as PgClient
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const started = now()
  let held: LockConnection | undefined
  let attempt = 0

  while (!held) {
    let connection: LockConnection | undefined
    try {
      connection = await pgClient.acquireConnection()
      const result = await connection.query(TRY_LOCK_SQL, [
        String(ECUADOR_SETUP_LOCK_KEY),
      ])
      if (booleanColumn(result, "acquired")) {
        held = connection
        break
      }
    } catch (error) {
      if (connection) {
        await releaseQuiet(pgClient, connection)
      }
      throw lockConnectionError(error)
    }
    await releaseQuiet(pgClient, connection)
    if (now() - started >= ECUADOR_SETUP_LOCK_LIMIT_MS) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        LOCK_BUSY_MESSAGE
      )
    }
    const remaining = ECUADOR_SETUP_LOCK_LIMIT_MS - (now() - started)
    const wait = Math.min(delayMs(attempt), remaining)
    attempt += 1
    if (wait > 0) {
      await sleep(wait)
    }
    if (now() - started >= ECUADOR_SETUP_LOCK_LIMIT_MS) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        LOCK_BUSY_MESSAGE
      )
    }
  }

  try {
    return await run()
  } finally {
    let unlocked = false
    try {
      const result = await held.query(UNLOCK_SQL, [
        String(ECUADOR_SETUP_LOCK_KEY),
      ])
      unlocked = booleanColumn(result, "unlocked")
    } catch {
      unlocked = false
    }
    if (unlocked) {
      await releaseQuiet(pgClient, held)
    } else {
      await destroyHeldConnection(pgClient, held)
    }
  }
}
