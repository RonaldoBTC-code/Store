import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { MedusaError } from "@medusajs/framework/utils"
import type { PayphoneHttpClient } from "../../payphone/client"
import { retryPayphoneReversals } from "../../../jobs/payphone-reverse"
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

        const constraints = await MikroOrmWrapper.getManager().execute(
          `select conname from pg_constraint where conname = 'payphone_claim_transaction_id_key'`
        )
        expect(constraints).toEqual([
          { conname: "payphone_claim_transaction_id_key" },
        ])
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
        expect(sale.confirms()).toBe(1)
      })

      it("creates nothing for a replayed callback", async () => {
        const sale = saleHarness(service, 83)
        const first = await sale.fulfill("return")
        const replay = await sale.fulfill("return")

        expect(first).toMatchObject({ ok: true, orderId: "order_01RACE" })
        expect(replay).toEqual(first)
        expect(sale.confirms()).toBe(1)
        expect(sale.completes()).toBe(1)

        const forged = await fulfillPayphoneSale(
          {
            loadSession: async () => ({
              id: "payses_forged",
              amount: "34.99",
              currency_code: "usd",
              provider_id: PAYPHONE_PROVIDER_ID,
              payment_collection_id: "paycol_forged",
              data: {
                amount_cents: 3499,
                session_id: "payses_forged",
                payphone_confirmed: false,
              },
            }),
            loadCartId: async () => "cart_forged",
            findOrderId: async () => null,
            findClaim: (clientTransactionId) =>
              service.getByClientTransactionId(clientTransactionId),
            settle: (input) =>
              settlePayphonePayment(
                {
                  claims: service,
                  client: {
                    prepare: async () => {
                      throw new MedusaError(
                        MedusaError.Types.UNEXPECTED_STATE,
                        "prepare is not part of settle"
                      )
                    },
                    confirm: async () => {
                      throw new MedusaError(
                        MedusaError.Types.UNEXPECTED_STATE,
                        "forged confirm"
                      )
                    },
                    reverse: async () => undefined,
                  },
                  loadCart: async () => ({
                    id: "cart_forged",
                    currencyCode: "usd",
                    total: "34.99",
                    taxTotal: "4.56",
                    shippingTotal: 0,
                    shippingTaxTotal: 0,
                  }),
                  complete: async () => {
                    throw new MedusaError(
                      MedusaError.Types.UNEXPECTED_STATE,
                      "forged complete"
                    )
                  },
                },
                {
                  sessionCartId: input.cart_id,
                  sessionId: input.session_id,
                  currencyCode: input.currency_code,
                  initiatedAmountCents: input.initiated_amount_cents,
                  payphoneTransactionId: input.payphone_transaction_id,
                  sessionData: input.data,
                }
              ),
          },
          {
            clientTransactionId: "payses_forged",
            payphoneTransactionId: 83,
          }
        )

        expect(forged.ok).toBe(false)
        const captured = await service.listPayphoneClaims({
          transaction_id: "83",
        })
        expect(captured).toHaveLength(1)
        expect(captured[0]?.order_id).toBe("order_01RACE")
      })

      it("reverses when the cart changed after the payment was created", async () => {
        let reverses = 0
        const client: PayphoneHttpClient = {
          prepare: async () => {
            throw new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "prepare is not part of settle"
            )
          },
          confirm: async () => {
            throw new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "confirm should not run"
            )
          },
          reverse: async () => {
            reverses += 1
          },
        }

        await expect(
          settlePayphonePayment(
            {
              claims: service,
              client,
              loadCart: async () => ({
                id: "cart_changed",
                currencyCode: "usd",
                total: "36.00",
                taxTotal: "4.70",
                shippingTotal: 0,
                shippingTaxTotal: 0,
              }),
              complete: async () => ({ orderId: "order_should_not" }),
            },
            {
              sessionCartId: "cart_changed",
              sessionId: "payses_changed",
              currencyCode: "usd",
              initiatedAmountCents: 3499,
              payphoneTransactionId: 84,
              sessionData: { amount_cents: 3499 },
            }
          )
        ).rejects.toThrow(PayphoneResultCode.cartChanged)

        expect(reverses).toBe(1)
        const [claim] = await service.listPayphoneClaims({
          client_transaction_id: "payses_changed",
        })
        expect(claim?.status).toBe("reversed")
        expect(claim?.order_id ?? null).toBeNull()
      })

      it("keeps needs_reversal until the job reverses once", async () => {
        let reverses = 0
        const client: PayphoneHttpClient = {
          prepare: async () => {
            throw new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "prepare is not part of settle"
            )
          },
          confirm: async () => ({
            amount: 3499,
            clientTransactionId: "payses_85",
            statusCode: 3,
            transactionStatus: "Approved",
            transactionId: 85,
            currency: "USD",
          }),
          reverse: async () => {
            reverses += 1
            if (reverses === 1) {
              throw new MedusaError(
                MedusaError.Types.UNEXPECTED_STATE,
                "reverse timeout"
              )
            }
          },
        }

        await expect(
          settlePayphonePayment(
            {
              claims: service,
              client,
              loadCart: async () => ({
                id: "cart_85",
                currencyCode: "usd",
                total: "34.99",
                taxTotal: "4.56",
                shippingTotal: 0,
                shippingTaxTotal: 0,
              }),
              complete: async () => {
                throw new MedusaError(
                  MedusaError.Types.INVALID_DATA,
                  "La cédula o el RUC no es válido."
                )
              },
            },
            {
              sessionCartId: "cart_85",
              sessionId: "payses_85",
              currencyCode: "usd",
              initiatedAmountCents: 3499,
              payphoneTransactionId: 85,
              sessionData: { amount_cents: 3499 },
            }
          )
        ).rejects.toThrow(PayphoneResultCode.failed)

        const [pending] = await service.listPayphoneClaims({
          client_transaction_id: "payses_85",
        })
        expect(pending?.status).toBe("needs_reversal")
        expect(reverses).toBe(1)

        const deps = {
          listWork: (graceSeconds: number) =>
            service.listReversalWork(graceSeconds),
          claimReversal: (id: string) => service.claimReversal(id),
          markReversed: (id: string) => service.markReversed(id),
          releaseReversal: (id: string) => service.releaseReversal(id),
          markCaptured: (
            clientTransactionId: string,
            transactionId: string,
            orderId: string
          ) => service.markCaptured(clientTransactionId, transactionId, orderId),
          findOrderId: async () => null,
          reverse: (transactionId: number) => client.reverse(transactionId),
          graceSeconds: 0,
        }
        await retryPayphoneReversals(deps)
        await retryPayphoneReversals(deps)

        expect(reverses).toBe(2)
        const [done] = await service.listPayphoneClaims({
          client_transaction_id: "payses_85",
        })
        expect(done?.status).toBe("reversed")
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
