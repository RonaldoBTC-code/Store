import fs from "fs"

/**
 * SSL de Postgres para Medusa.
 *
 * Local y CI quedan sin SSL. Producción verifica el certificado.
 * Nunca se usa rejectUnauthorized: false.
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

const CI_FLAGS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS"]

export function isContinuousIntegration(env: ProcessEnv): boolean {
  return CI_FLAGS.some((name) => isTruthyFlag(env[name]))
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === "1" || normalized === "true"
}

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
 * Si DATABASE_SSL no viene definido: encendido solo en producción y fuera de CI.
 */
export function defaultDatabaseSslEnabled(env: ProcessEnv): boolean {
  return env.NODE_ENV === "production" && !isContinuousIntegration(env)
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
    throw new Error(
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
    throw new Error(
      "DATABASE_CA_CERT debe ser un PEM o la ruta a un archivo PEM legible. No se pudo leer el certificado."
    )
  }

  if (!pem.trim()) {
    throw new Error(
      "DATABASE_CA_CERT apunta a un archivo vacío. Hace falta el PEM del CA."
    )
  }

  return pem
}

function readCaFileFromDisk(filePath: string): string {
  return fs.readFileSync(filePath, "utf8")
}
