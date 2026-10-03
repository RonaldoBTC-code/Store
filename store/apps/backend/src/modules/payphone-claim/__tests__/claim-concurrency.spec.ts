import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { MedusaError } from "@medusajs/framework/utils"
import type { PayphoneHttpClient } from "../../payphone/client"
import { fulfillPayphoneSale } from "../../payphone/fulfill"
import { PAYPHONE_PROVIDER_ID } from "../../payphone/providers"
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

      it("completes exactly one order from the webhook alone", async () => {
        const sale = saleHarness(service, 81)
        const first = await sale.fulfill("webhook")
        const second = await sale.fulfill("webhook")

        expect(first).toMatchObject({ ok: true, orderId: "order_01WEBHOOK" })
        expect(second).toEqual(first)
        expect(sale.confirms()).toBe(1)
        expect(sale.completes()).toBe(1)
      })

      it("gives one order when the webhook and the return race", async () => {
        const sale = saleHarness(service, 82)
        const results = await Promise.all([
          sale.fulfill("webhook"),
          sale.fulfill("return"),
        ])
        const orders = results.filter((result) => result.ok)

        expect(sale.confirms()).toBe(1)
        expect(sale.completes()).toBe(1)
        expect(orders.length).toBeGreaterThan(0)
        expect(new Set(orders.map((result) => result.orderId))).toEqual(
          new Set(["order_01RACE"])
        )

        const claims = await service.listPayphoneClaims({
          client_transaction_id: "payses_82",
        })
        expect(claims).toHaveLength(1)
        expect(claims[0]).toMatchObject({ status: "captured" })
      })
    })
  },
})

function saleHarness(service: PayphoneClaimModuleService, transactionId: number) {
  let confirms = 0
  let completes = 0
  let orderId: string | null = null
  const sessionId = `payses_${transactionId}`
  const createdOrderId =
    transactionId === 81 ? "order_01WEBHOOK" : "order_01RACE"
  const client: PayphoneHttpClient = {
    prepare: async () => {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "prepare is not part of settle"
      )
    },
    confirm: async () => {
      confirms += 1
      return {
        amount: 3499,
        clientTransactionId: sessionId,
        statusCode: 3,
        transactionStatus: "Approved",
        transactionId,
        currency: "USD",
      }
    },
    reverse: async () => undefined,
  }

  const fulfill = (source: "webhook" | "return") =>
    fulfillPayphoneSale(
      {
        loadSession: async () => ({
          id: sessionId,
          amount: "34.99",
          currency_code: "usd",
          provider_id: PAYPHONE_PROVIDER_ID,
          payment_collection_id: "paycol_01",
          data: {
            amount_cents: 3499,
            session_id: sessionId,
            payphone_confirmed: false,
          },
        }),
        loadCartId: async () => CART,
        findOrderId: async () => orderId,
        findClaim: (clientTransactionId) =>
          service.getByClientTransactionId(clientTransactionId),
        settle: (input) =>
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
                orderId = createdOrderId
                return { orderId: createdOrderId }
              },
            },
            {
              sessionCartId: input.cart_id,
              requestCartId:
                source === "return" ? input.request_cart_id : null,
              sessionId: input.session_id,
              currencyCode: input.currency_code,
              initiatedAmountCents: input.initiated_amount_cents,
              payphoneTransactionId: input.payphone_transaction_id,
              sessionData: input.data,
            }
          ),
      },
      {
        clientTransactionId: sessionId,
        payphoneTransactionId: transactionId,
        requestCartId: source === "return" ? CART : null,
      }
    )

  return {
    fulfill,
    confirms: () => confirms,
    completes: () => completes,
  }
}
