import { enforceStartupSecrets } from "./src/utils/validate-production-secrets"

/**
 * En producción el chequeo corre para el comando en curso, salvo
 * `build`, `db:*`, `exec`, `user` y `plugin:*`.
 * CI no lo omite. UNSAFE_SKIP_STARTUP_CHECKS solo omite secretos.
 *
 * OpenTelemetry sigue siendo opcional. Para activarlo, ver
 * https://docs.medusajs.com/learn/debugging-and-testing/instrumentation
 */
export function register(): void {
  try {
    enforceStartupSecrets(process.env, process.argv)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Configuración de producción inválida."
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
