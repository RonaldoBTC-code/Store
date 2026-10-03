import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import type { PayphoneHttpClient } from "../../payphone/client"
import { settlePayphonePayment } from "../../payphone/settle"
import { PayphoneResultCode } from "../../payphone/service"
import { PAYPHONE_CLAIM_MODULE } from "../index"
import PayphoneClaim from "../models/payphone-claim"
import PayphoneClaimModuleService from "../service"

jest.setTimeout(120_000)

const SESSION = "payses_01RACE"
const CART = "cart_01RACE"

moduleIntegrationTestRunner<PayphoneClaimModuleService>({
  moduleName: PAYPHONE_CLAIM_MODULE,
  moduleModels: [PayphoneClaim],
  resolve: "./src/modules/payphone-claim",
  pathToMigrations: path.join(__dirname, "../migrations"),
  testSuite: ({ service, MikroOrmWrapper }) => {
    describe("PayPhone claim concurrency", () => {
      it("lets one of two simultaneous confirms create the order", async () => {
        let confirms = 0
        let completes = 0
        const client: PayphoneHttpClient = {
          prepare: async () => {
            throw new Error("prepare is not part of settle")
          },
          confirm: async () => {
            confirms += 1
            return {
              amount: 3499,
              clientTransactionId: SESSION,
              statusCode: 3,
              transactionStatus: "Approved",
              transactionId: 77,
              currency: "USD",
            }
          },
          reverse: async () => undefined,
        }

        const run = () =>
          settlePayphonePayment(
            {
              claims: service,
              client,
              loadCart: async () => ({
                id: CART,
                currencyCode: "usd",
                total: "34.99",
                taxTotal: "4.56",
                shippingTotal: 0,
                shippingTaxTotal: 0,
              }),
              complete: async () => {
                completes += 1
                return { orderId: "order_01RACE" }
              },
            },
            {
              sessionCartId: CART,
              sessionId: SESSION,
              currencyCode: "usd",
              initiatedAmountCents: 3499,
              payphoneTransactionId: 77,
              sessionData: {
                session_id: SESSION,
                amount_cents: 3499,
                payphone_confirmed: false,
              },
            }
          )

        const results = await Promise.allSettled([run(), run()])
        const fulfilled = results.filter((result) => result.status === "fulfilled")
        const rejected = results.filter((result) => result.status === "rejected")

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(confirms).toBe(1)
        expect(completes).toBe(1)

        const failure = rejected[0]
        expect(failure.status).toBe("rejected")
        if (failure.status === "rejected") {
          expect(String(failure.reason)).toContain(PayphoneResultCode.inProgress)
        }

        const claims = await service.listPayphoneClaims({
          client_transaction_id: SESSION,
        })
        expect(claims).toHaveLength(1)
        expect(claims[0]).toMatchObject({
          status: "captured",
          order_id: "order_01RACE",
          transaction_id: "77",
          amount_cents: 3499,
        })

        const indexes = await MikroOrmWrapper.getManager().execute(
          `select indexname from pg_indexes where tablename = 'payphone_claim'`
        )
        expect(indexes).toEqual(
          expect.arrayContaining([
            {
              indexname: "IDX_payphone_claim_client_transaction_id_unique",
            },
          ])
        )
      })
    })
  },
})
