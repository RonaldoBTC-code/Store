import { loadEnv, defineConfig } from "@medusajs/framework/utils"
import { resolveDatabaseSsl } from "./src/utils/database-ssl"
import { enforceStartupSecrets } from "./src/utils/validate-production-secrets"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// El chequeo solo se aplica en `medusa start` / `medusa develop` con
// NODE_ENV=production y fuera de CI. `medusa build`, migraciones y seeds
// cargan este archivo y siguen de largo.
enforceStartupSecrets(process.env, process.argv)

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
