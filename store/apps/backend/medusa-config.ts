import { loadEnv, defineConfig } from "@medusajs/framework/utils"
import {
  resolveDatabaseConnection,
  warnIfProductionSslDisabled,
} from "./src/utils/database-ssl"
import { enforceStartupSecrets } from "./src/utils/validate-production-secrets"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// En producción el chequeo corre salvo build, db:*, exec, user y plugin:*.
// CI no lo salta. UNSAFE_SKIP_STARTUP_CHECKS omite solo este chequeo.
enforceStartupSecrets(process.env, process.argv)
warnIfProductionSslDisabled(process.env)

// pg lee PGSSLMODE solo si `ssl` es undefined. Aquí siempre es false
// o { rejectUnauthorized: true }, así que PGSSLMODE=disable no lo pisa.
// Los parámetros TLS de la URL ya se quitaron: no pueden reemplazar `ssl`.
const database = resolveDatabaseConnection(process.env)

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: database.databaseUrl,
    databaseDriverOptions: {
      connection: {
        ssl: database.ssl,
      },
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
})
