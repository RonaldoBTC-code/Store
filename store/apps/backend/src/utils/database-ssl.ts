import fs from "fs"
import { MedusaError } from "@medusajs/framework/utils"
import { isProductionEnv } from "./node-env"

/**
 * SSL de Postgres para Medusa.
 *
 * Fuera de producción queda apagado si DATABASE_SSL no se define.
 * En producción (production o prod) se verifica el certificado.
 * CI no cambia esa decisión. Nunca se usa rejectUnauthorized: false.
 */

export type ProcessEnv = Record<string, string | undefined>

export type VerifiedDatabaseSsl = {
  rejectUnauthorized: true
  ca?: string
}

export type DatabaseSslConfig = false | VerifiedDatabaseSsl

const SSL_DISABLED = new Set([
  "0",
  "false",
  "off",
  "no",
  "disable",
  "disabled",
])

/**
 * Parámetros de TLS que `pg` y `pg-connection-string` leen de la query.
 * Lockfile: pg 8.20.0 (Knex/MikroORM, el que abre la conexión) y pg 8.23.0;
 * pg-connection-string 2.14.0 (el que resuelve pg 8.20) y 2.6.2.
 *
 * `ConnectionParameters` hace Object.assign del parseo de la URL encima
 * de `ssl`. Con eso, `sslmode=no-verify` deja `rejectUnauthorized: false`,
 * `ssl=0` deja `ssl: false` y `ssl=false` reemplaza el objeto por el
 * string "false". `sslnegotiation=direct` fuerza `ssl: true`.
 * `uselibpqcompat=true` con `sslmode=require` apaga la verificación.
 * `sslcert`, `sslkey` y `sslrootcert` leen archivos y arman el objeto.
 * `sslpassword` no cambia el objeto en estas versiones; es parámetro TLS
 * de libpq y no debe seguir en la URL.
 */
export const DATABASE_URL_TLS_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslrootcert",
  "uselibpqcompat",
  "sslnegotiation",
] as const

const TLS_QUERY_PARAMETERS = new Set<string>(DATABASE_URL_TLS_PARAMETERS)

export const STRIPPED_TLS_PARAMETERS_WARNING =
  "ADVERTENCIA: se quitaron parámetros TLS de DATABASE_URL. El SSL lo deciden DATABASE_SSL y DATABASE_CA_CERT."

export const PRODUCTION_SSL_DISABLED_WARNING =
  "ADVERTENCIA: DATABASE_SSL=false en producción. La conexión a Postgres no usa SSL."

function unwrap(value: string | undefined): string {
  let trimmed = value?.trim() ?? ""
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Si DATABASE_SSL no viene definido: encendido solo en producción.
 */
export function defaultDatabaseSslEnabled(env: ProcessEnv): boolean {
  return isProductionEnv(env.NODE_ENV)
}

/**
 * Aviso, no error. No incluye DATABASE_URL.
 * Solo cuando producción pide SSL apagado de forma explícita.
 */
export function productionSslDisabledWarning(
  env: ProcessEnv
): string | undefined {
  if (!isProductionEnv(env.NODE_ENV)) {
    return undefined
  }

  const requested = unwrap(env.DATABASE_SSL).toLowerCase()
  if (!SSL_DISABLED.has(requested)) {
    return undefined
  }

  return PRODUCTION_SSL_DISABLED_WARNING
}

export function warnIfProductionSslDisabled(
  env: ProcessEnv,
  warn: (message: string) => void = writeWarning
): void {
  const message = productionSslDisabledWarning(env)
  if (message) {
    warn(message)
  }
}

/**
 * Resuelve ssl para databaseDriverOptions.connection.
 * readCaFile se inyecta en tests; en runtime lee el archivo del disco.
 */
export function resolveDatabaseSsl(
  env: ProcessEnv,
  readCaFile: (filePath: string) => string = readCaFileFromDisk
): DatabaseSslConfig {
  const requested = unwrap(env.DATABASE_SSL).toLowerCase()
  let enabled: boolean

  if (!requested) {
    enabled = defaultDatabaseSslEnabled(env)
  } else if (SSL_DISABLED.has(requested)) {
    enabled = false
  } else {
    // require, true, on, verify-full y cualquier otro valor distinto
    // de un apagado explícito verifican el certificado.
    enabled = true
  }

  if (!enabled) {
    return false
  }

  const ca = loadCaCertificate(unwrap(env.DATABASE_CA_CERT), readCaFile)
  if (!ca) {
    return { rejectUnauthorized: true }
  }

  return {
    rejectUnauthorized: true,
    ca,
  }
}

function loadCaCertificate(
  raw: string,
  readCaFile: (filePath: string) => string
): string | undefined {
  if (!raw) {
    return undefined
  }

  if (raw.includes("BEGIN CERTIFICATE")) {
    return raw.replace(/\\n/g, "\n")
  }

  let pem: string
  try {
    pem = readCaFile(raw)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "DATABASE_CA_CERT debe ser un PEM o la ruta a un archivo PEM legible. No se pudo leer el certificado."
    )
  }

  if (!pem.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "DATABASE_CA_CERT apunta a un archivo vacío. Hace falta el PEM del CA."
    )
  }

  return pem
}

function readCaFileFromDisk(filePath: string): string {
  return fs.readFileSync(filePath, "utf8")
}

export type SanitizedDatabaseUrl = {
  databaseUrl: string | undefined
  removedTlsParameters: string[]
}

/**
 * Quita de la query los parámetros TLS. El resto de la URL, usuario,
 * contraseña y parámetros como application_name quedan igual.
 * No registra la URL.
 */
export function sanitizeDatabaseUrl(
  databaseUrl: string | undefined
): SanitizedDatabaseUrl {
  if (databaseUrl === undefined) {
    return { databaseUrl: undefined, removedTlsParameters: [] }
  }

  const hashIndex = databaseUrl.indexOf("#")
  const withoutHash =
    hashIndex === -1 ? databaseUrl : databaseUrl.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : databaseUrl.slice(hashIndex)
  const queryIndex = withoutHash.indexOf("?")

  if (queryIndex === -1) {
    return { databaseUrl, removedTlsParameters: [] }
  }

  const base = withoutHash.slice(0, queryIndex)
  const query = withoutHash.slice(queryIndex + 1)
  const removed: string[] = []
  const kept: string[] = []

  for (const part of query.split("&")) {
    if (!part) {
      continue
    }

    const eq = part.indexOf("=")
    const rawKey = eq === -1 ? part : part.slice(0, eq)
    const key = decodeQueryKey(rawKey)

    if (TLS_QUERY_PARAMETERS.has(key)) {
      if (!removed.includes(key)) {
        removed.push(key)
      }
      continue
    }

    kept.push(part)
  }

  if (removed.length === 0) {
    return { databaseUrl, removedTlsParameters: [] }
  }

  const sanitized =
    kept.length === 0 ? `${base}${hash}` : `${base}?${kept.join("&")}${hash}`

  return { databaseUrl: sanitized, removedTlsParameters: removed }
}

export function strippedTlsParametersWarning(
  parameters: readonly string[]
): string {
  return `${STRIPPED_TLS_PARAMETERS_WARNING} Parámetros: ${parameters.join(", ")}.`
}

export type DatabaseConnectionConfig = {
  databaseUrl: string | undefined
  ssl: DatabaseSslConfig
}

/**
 * URL sin parámetros TLS y objeto ssl para el driver.
 * `ssl` nunca queda undefined: pg solo lee PGSSLMODE en ese caso.
 */
export function resolveDatabaseConnection(
  env: ProcessEnv,
  warn: (message: string) => void = writeWarning,
  readCaFile: (filePath: string) => string = readCaFileFromDisk
): DatabaseConnectionConfig {
  const sanitized = sanitizeDatabaseUrl(env.DATABASE_URL)

  if (sanitized.removedTlsParameters.length > 0) {
    warn(strippedTlsParametersWarning(sanitized.removedTlsParameters))
  }

  return {
    databaseUrl: sanitized.databaseUrl,
    ssl: resolveDatabaseSsl(env, readCaFile),
  }
}

function decodeQueryKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " ")).trim().toLowerCase()
  } catch {
    return rawKey.trim().toLowerCase()
  }
}

function writeWarning(message: string): void {
  process.stderr.write(`${message}\n`)
}
