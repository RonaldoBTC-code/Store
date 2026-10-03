import { loadEnv, defineConfig } from "@medusajs/framework/utils"
import {
  resolveDatabaseSsl,
  warnIfProductionSslDisabled,
} from "./src/utils/database-ssl"
import { enforceStartupSecrets } from "./src/utils/validate-production-secrets"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Secretos: solo `medusa start` / `medusa develop` en producción
// (`production` o `prod`). CI no lo salta. UNSAFE_SKIP_STARTUP_CHECKS
// omite solo este chequeo. `medusa build`, migraciones y seeds no entran.
enforceStartupSecrets(process.env, process.argv)
warnIfProductionSslDisabled(process.env)

const databaseSsl = resolveDatabaseSsl(process.env)

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      connection: {
        ssl: databaseSsl,
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
