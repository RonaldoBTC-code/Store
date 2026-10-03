import { MedusaError } from "@medusajs/framework/utils"

type SeedEnv = {
  NODE_ENV?: string
  ALLOW_PROD_SEED?: string
  DATABASE_URL?: string
  PGHOST?: string
  PGHOSTADDR?: string
}

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

const PRODUCTION_NODE_ENVS = new Set(["production", "prod"])

/**
 * Product and demo seeds are for local dev and CI.
 * Base store setup used by `medusa db:migrate` does not call this.
 *
 * The database host is the primary check. Only localhost, 127.0.0.1, and
 * ::1 are local. The host is the URL authority, never a `host` or
 * `hostaddr` query parameter (including a socket path) and never an `@`
 * that appears only in the query string. A URL with no host falls back to
 * PGHOST and PGHOSTADDR, which must be on that same list; otherwise it is
 * a socket and is not local. A missing, empty, or unparseable DATABASE_URL
 * is not local. NODE_ENV is also refused when it normalizes to production
 * or prod. Errors never include the connection string.
 */
export function assertSeedAllowed(env: SeedEnv = process.env) {
  if (env.ALLOW_PROD_SEED === "true") {
    return
  }

  if (!databaseHostIsLocal(env.DATABASE_URL, env)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to run a seed script because the database host is non-local. Set ALLOW_PROD_SEED=true to opt in."
    )
  }

  if (isProductionNodeEnv(env.NODE_ENV)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to run a seed script while NODE_ENV=production. Set ALLOW_PROD_SEED=true to opt in."
    )
  }
}

export function isProductionNodeEnv(nodeEnv: string | undefined) {
  if (!nodeEnv?.trim()) {
    return false
  }
  return PRODUCTION_NODE_ENVS.has(nodeEnv.trim().toLowerCase())
}

export function databaseHostIsLocal(
  databaseUrl: string | undefined,
  env: Pick<SeedEnv, "PGHOST" | "PGHOSTADDR"> = {}
) {
  if (!databaseUrl?.trim()) {
    return false
  }

  const host = readDatabaseHost(databaseUrl, env)
  if (!host) {
    return false
  }

  return isLocalHost(host)
}

function isLocalHost(host: string) {
  const normalized = host.replace(/^\[|\]$/g, "").trim().toLowerCase()
  return Boolean(normalized) && LOCAL_DATABASE_HOSTS.has(normalized)
}

function readDatabaseHost(
  databaseUrl: string,
  env: Pick<SeedEnv, "PGHOST" | "PGHOSTADDR">
) {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl.trim())
  } catch {
    return null
  }

  for (const key of parsed.searchParams.keys()) {
    const name = key.toLowerCase()
    if (name === "host" || name === "hostaddr") {
      return null
    }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").trim()
  if (host) {
    return host
  }

  return fallbackHost(env)
}

function fallbackHost(env: Pick<SeedEnv, "PGHOST" | "PGHOSTADDR">) {
  const hostAddr = env.PGHOSTADDR?.trim()
  const pgHost = env.PGHOST?.trim()
  if (!hostAddr && !pgHost) {
    return null
  }
  if (hostAddr && !isLocalHost(hostAddr)) {
    return null
  }
  if (pgHost && !isLocalHost(pgHost)) {
    return null
  }
  return hostAddr || pgHost || null
}
