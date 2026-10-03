import { MedusaError } from "@medusajs/framework/utils"
import type { ProcessEnv } from "./database-ssl"
import { isProductionEnv } from "./node-env"

/**
 * Chequeo puro de secretos. Quien arranca el servidor decide si aplicarlo.
 * No lee process.env por su cuenta: recibe el entorno.
 * El mensaje nombra la variable y la regla, nunca el valor.
 */

export type { ProcessEnv }

export const MIN_SECRET_LENGTH = 32

/**
 * Valores de plantilla conocidos. El de .env.template es la cadena vacía
 * y se reporta como ausente.
 */
export const TEMPLATE_SECRETS = [
  "supersecret",
  "changeme",
  "secret",
  "password",
] as const

export const ENV_TEMPLATE_SECRET = ""

export const UNSAFE_SKIP_STARTUP_CHECKS_WARNING =
  "ADVERTENCIA: UNSAFE_SKIP_STARTUP_CHECKS=true. Se omite el chequeo de JWT_SECRET, COOKIE_SECRET y DATABASE_URL. El SSL de Postgres no se omite."

export type SecretVariable = "JWT_SECRET" | "COOKIE_SECRET" | "DATABASE_URL"

export type SecretIssueCode = "missing" | "template" | "too_short" | "equal"

export type SecretIssue = {
  variable: SecretVariable
  code: SecretIssueCode
}

const SECRET_VARIABLES = ["JWT_SECRET", "COOKIE_SECRET"] as const

export function validateProductionSecrets(env: ProcessEnv): SecretIssue[] {
  const issues: SecretIssue[] = []
  const values: Partial<Record<(typeof SECRET_VARIABLES)[number], string>> = {}

  for (const variable of SECRET_VARIABLES) {
    const value = env[variable]?.trim() ?? ""
    if (!value || value === ENV_TEMPLATE_SECRET) {
      issues.push({ variable, code: "missing" })
      continue
    }

    values[variable] = value

    if (TEMPLATE_SECRETS.some((template) => template === value.toLowerCase())) {
      issues.push({ variable, code: "template" })
    }

    if (value.length < MIN_SECRET_LENGTH) {
      issues.push({ variable, code: "too_short" })
    }
  }

  const jwt = values.JWT_SECRET
  const cookie = values.COOKIE_SECRET
  if (jwt && cookie && jwt === cookie) {
    issues.push({ variable: "JWT_SECRET", code: "equal" })
  }

  if (!env.DATABASE_URL?.trim()) {
    issues.push({ variable: "DATABASE_URL", code: "missing" })
  }

  return issues
}

/**
 * Subcomando de la CLI de Medusa 2.21 (`@medusajs/cli` create-cli).
 * process.argv es [binario, script, ...]. Esos dos primeros elementos
 * nunca son el subcomando, aunque argv venga corto.
 * Las flags globales booleanas (`--json`, `--verbose`, `--no-color`)
 * pueden ir antes del comando. El primer token que no es flag, a partir
 * del tercero, es el subcomando. `medusa develop` carga esta config en
 * el padre; el hijo que abre el servidor recibe `start`.
 */
export function medusaCommandFromArgv(
  argv: readonly string[]
): string | undefined {
  const tokens = argv.slice(2)

  for (const token of tokens) {
    if (token === "--") {
      return undefined
    }
    if (token.startsWith("-")) {
      continue
    }
    return token
  }

  return undefined
}

/**
 * Excepciones explícitas. Cualquier otro comando, uno desconocido,
 * o una invocación sin argumentos, no entra aquí.
 * CLI 2.21: build, db:setup, db:create, db:migrate, db:migrate:scripts,
 * db:migrate:search, db:rollback, db:generate, db:sync-links, exec, user,
 * plugin:db:generate, plugin:build, plugin:develop, plugin:publish, plugin:add.
 */
export function isExcludedMedusaCommand(
  command: string | undefined
): boolean {
  if (!command) {
    return false
  }
  if (command === "build" || command === "exec" || command === "user") {
    return true
  }
  if (command.startsWith("db:") || command.startsWith("plugin:")) {
    return true
  }
  return false
}

export function unsafeSkipStartupChecks(env: ProcessEnv): boolean {
  return env.UNSAFE_SKIP_STARTUP_CHECKS?.trim().toLowerCase() === "true"
}

/**
 * La config se carga más de una vez en el mismo proceso. El aviso de
 * UNSAFE_SKIP_STARTUP_CHECKS sale una sola vez.
 */
let unsafeSkipStartupChecksWarningEmitted = false

export function resetUnsafeSkipStartupChecksWarningForTests(): void {
  unsafeSkipStartupChecksWarningEmitted = false
}

export function shouldEnforceStartupSecrets(
  env: ProcessEnv,
  argv: readonly string[]
): boolean {
  if (!isProductionEnv(env.NODE_ENV)) {
    return false
  }
  if (isExcludedMedusaCommand(medusaCommandFromArgv(argv))) {
    return false
  }
  if (unsafeSkipStartupChecks(env)) {
    return false
  }
  return true
}

export function formatStartupSecretError(issues: SecretIssue[]): string {
  const lines = issues.map((issue) => `- ${describeIssue(issue)}`)

  return [
    "El servidor no arranca: la configuración de producción no es válida.",
    ...lines,
    "Define DATABASE_URL. Genera JWT_SECRET y COOKIE_SECRET distintos, de al menos 32 caracteres, con `openssl rand -base64 48`.",
  ].join("\n")
}

function describeIssue(issue: SecretIssue): string {
  switch (issue.code) {
    case "missing":
      return `${issue.variable} falta`
    case "template":
      return `${issue.variable} usa un valor de plantilla conocido`
    case "too_short":
      return `${issue.variable} tiene menos de 32 caracteres`
    case "equal":
      return "JWT_SECRET y COOKIE_SECRET son iguales"
  }
}

export function enforceStartupSecrets(
  env: ProcessEnv,
  argv: readonly string[],
  warn: (message: string) => void = writeWarning
): void {
  if (!isProductionEnv(env.NODE_ENV)) {
    return
  }
  if (isExcludedMedusaCommand(medusaCommandFromArgv(argv))) {
    return
  }

  if (unsafeSkipStartupChecks(env)) {
    if (!unsafeSkipStartupChecksWarningEmitted) {
      unsafeSkipStartupChecksWarningEmitted = true
      warn(UNSAFE_SKIP_STARTUP_CHECKS_WARNING)
    }
    return
  }

  const issues = validateProductionSecrets(env)
  if (issues.length === 0) {
    return
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    formatStartupSecretError(issues)
  )
}

function writeWarning(message: string): void {
  process.stderr.write(`${message}\n`)
}
