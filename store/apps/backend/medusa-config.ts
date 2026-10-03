import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { databaseSsl } from './src/utils/database-ssl'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const btcpayEnabled = [
  process.env.BTCPAY_URL,
  process.env.BTCPAY_STORE_ID,
  process.env.BTCPAY_API_KEY,
  process.env.BTCPAY_WEBHOOK_SECRET,
].every((value) => typeof value === 'string' && value.trim().length > 0)

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      connection: {
        ssl: databaseSsl(process.env.DATABASE_URL),
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
  modules: btcpayEnabled
    ? [
        {
          resolve: './src/modules/btcpay-claim',
        },
        {
          resolve: '@medusajs/medusa/payment',
          options: {
            providers: [
              {
                resolve: './src/modules/btcpay',
                id: 'btcpay',
              },
            ],
          },
        },
      ]
    : [],
})
