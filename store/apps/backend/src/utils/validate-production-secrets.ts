import { isContinuousIntegration, type ProcessEnv } from "./database-ssl"

/**
 * Chequeo puro de secretos. Quien arranca el servidor decide si aplicarlo.
 * No lee process.env por su cuenta: recibe el entorno.
 */

export type { ProcessEnv }

export const TEMPLATE_SECRET = "supersecret"

export type SecretVariable = "JWT_SECRET" | "COOKIE_SECRET" | "DATABASE_URL"

export type SecretIssueCode = "missing" | "template"

export type SecretIssue = {
  variable: SecretVariable
  code: SecretIssueCode
}

const SECRET_VARIABLES = ["JWT_SECRET", "COOKIE_SECRET"] as const

export function validateProductionSecrets(env: ProcessEnv): SecretIssue[] {
  const issues: SecretIssue[] = []

  for (const variable of SECRET_VARIABLES) {
    const value = env[variable]?.trim() ?? ""
    if (!value) {
      issues.push({ variable, code: "missing" })
      continue
    }
    if (value.toLowerCase() === TEMPLATE_SECRET) {
      issues.push({ variable, code: "template" })
    }
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

export function shouldEnforceStartupSecrets(
  env: ProcessEnv,
  argv: readonly string[]
): boolean {
  if (env.NODE_ENV !== "production") {
    return false
  }
  if (isContinuousIntegration(env)) {
    return false
  }
  return isMedusaServerCommand(argv)
}

export function formatStartupSecretError(issues: SecretIssue[]): string {
  const detail: Record<SecretIssueCode, string> = {
    missing: "falta",
    template: "usa el valor de plantilla y no sirve en producción",
  }

  const lines = issues.map(
    (issue) => `- ${issue.variable} ${detail[issue.code]}`
  )

  return [
    "El servidor no arranca: la configuración de producción no es válida.",
    ...lines,
    "Define DATABASE_URL. Genera JWT_SECRET y COOKIE_SECRET con `openssl rand -base64 48`.",
  ].join("\n")
}

export function enforceStartupSecrets(
  env: ProcessEnv,
  argv: readonly string[]
): void {
  if (!shouldEnforceStartupSecrets(env, argv)) {
    return
  }

  const issues = validateProductionSecrets(env)
  if (issues.length === 0) {
    return
  }

  throw new Error(formatStartupSecretError(issues))
}
