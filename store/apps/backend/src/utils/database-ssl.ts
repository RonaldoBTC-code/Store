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

const SSL_ENABLED = new Set([
  "1",
  "true",
  "on",
  "require",
  "verify-full",
])

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
  } else if (SSL_ENABLED.has(requested)) {
    enabled = true
  } else {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "DATABASE_SSL tiene un valor no reconocido. Usa true (verificar certificado) o false (sin SSL)."
    )
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

function writeWarning(message: string): void {
  process.stderr.write(`${message}\n`)
}
