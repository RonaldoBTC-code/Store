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
 * medusa start y medusa develop (el hijo de develop también recibe "start").
 * build, db:migrate y medusa exec no entran.
 */
export function isMedusaServerCommand(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "start" || arg === "develop")
}

export function unsafeSkipStartupChecks(env: ProcessEnv): boolean {
  return env.UNSAFE_SKIP_STARTUP_CHECKS?.trim().toLowerCase() === "true"
}

export function shouldEnforceStartupSecrets(
  env: ProcessEnv,
  argv: readonly string[]
): boolean {
  if (!isProductionEnv(env.NODE_ENV)) {
    return false
  }
  if (!isMedusaServerCommand(argv)) {
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
  if (!isProductionEnv(env.NODE_ENV) || !isMedusaServerCommand(argv)) {
    return
  }

  if (unsafeSkipStartupChecks(env)) {
    warn(UNSAFE_SKIP_STARTUP_CHECKS_WARNING)
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
