import { MedusaError } from "@medusajs/framework/utils"

type SeedEnv = {
  NODE_ENV?: string
  ALLOW_PROD_SEED?: string
  DATABASE_URL?: string
}

const LOCAL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
])

const PRODUCTION_NODE_ENVS = new Set(["production", "prod"])

/**
 * Product and demo seeds are for local dev and CI.
 * Base store setup used by `medusa db:migrate` does not call this.
 *
 * The database host is the primary check. NODE_ENV is also refused when it
 * normalizes to production or prod. Errors never include the connection string.
 */
export function assertSeedAllowed(env: SeedEnv = process.env) {
  if (env.ALLOW_PROD_SEED === "true") {
    return
  }

  if (!databaseHostIsLocal(env.DATABASE_URL)) {
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

export function databaseHostIsLocal(databaseUrl: string | undefined) {
  if (!databaseUrl?.trim()) {
    return true
  }

  const host = readDatabaseHost(databaseUrl)
  if (!host) {
    return false
  }

  return LOCAL_DATABASE_HOSTS.has(host.toLowerCase())
}

function readDatabaseHost(databaseUrl: string) {
  const trimmed = databaseUrl.trim()
  const at = trimmed.lastIndexOf("@")
  const authority =
    at >= 0
      ? trimmed.slice(at + 1)
      : trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")

  if (authority.startsWith("[")) {
    const end = authority.indexOf("]")
    if (end > 1) {
      return authority.slice(1, end)
    }
    return null
  }

  const host = authority.split("/")[0]?.split(":")[0]?.trim()
  return host || null
}
