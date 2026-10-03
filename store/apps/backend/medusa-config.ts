import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      connection: {
        ssl: { rejectUnauthorized: false },
      },
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/payphone",
            id: "payphone",
            options: {
              token: process.env.PAYPHONE_TOKEN,
              storeId: process.env.PAYPHONE_STORE_ID,
              responseUrl: process.env.PAYPHONE_RESPONSE_URL,
              cancellationUrl: process.env.PAYPHONE_CANCELLATION_URL,
            },
          },
        ],
      },
    },
  ],
})
