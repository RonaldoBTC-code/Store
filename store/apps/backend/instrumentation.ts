import { enforceStartupSecrets } from "./src/utils/validate-production-secrets"

/**
 * Medusa llama a register() solo al arrancar el servidor
 * (`medusa start`, y el proceso hijo de `medusa develop`).
 * No se ejecuta en `medusa build`, ni en `db:migrate`, ni en seeds.
 * CI no omite el chequeo. UNSAFE_SKIP_STARTUP_CHECKS solo omite secretos.
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
