import path from "path"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { MedusaError } from "@medusajs/framework/utils"
import { retryPayphoneReversals } from "../../src/jobs/payphone-reverse"
import {
  PayphoneApiError,
  type PayphoneHttpClient,
} from "../../src/modules/payphone/client"
import { fulfillPayphoneSale } from "../../src/modules/payphone/fulfill"
import { PAYPHONE_PROVIDER_ID } from "../../src/modules/payphone/providers"
import { PROCESSING_GRACE_SECONDS } from "../../src/modules/payphone/reverse-window"
import { PayphoneResultCode } from "../../src/modules/payphone/service"
import { settlePayphonePayment } from "../../src/modules/payphone/settle"
import {
  ALLOWED_CLAIM_TRANSITIONS,
  PAYPHONE_CLAIM_STATUSES,
  isAllowedClaimTransition,
} from "../../src/modules/payphone-claim/claim-transitions"
import { PAYPHONE_CLAIM_MODULE } from "../../src/modules/payphone-claim"
import PayphoneClaim from "../../src/modules/payphone-claim/models/payphone-claim"
import PayphoneClaimModuleService from "../../src/modules/payphone-claim/service"

jest.setTimeout(120_000)

const SESSION = "payses_01RACE"
const CART = "cart_01RACE"

moduleIntegrationTestRunner<PayphoneClaimModuleService>({
  moduleName: PAYPHONE_CLAIM_MODULE,
  moduleModels: [PayphoneClaim],
  resolve: "./src/modules/payphone-claim",
  pathToMigrations: path.join(
    __dirname,
    "../../src/modules/payphone-claim/migrations"
  ),
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
        const indexNames = (indexes as { indexname: string }[]).map(
          (row) => row.indexname
        )
        expect(indexNames).toEqual(
          expect.arrayContaining([
            "IDX_payphone_claim_client_transaction_id_unique",
            "IDX_payphone_claim_cart_open_unique",
            "IDX_payphone_claim_status_job",
            "payphone_claim_transaction_id_key",
          ])
        )
        expect(indexNames).not.toContain(
          "IDX_payphone_claim_transaction_id_unique"
        )

        const constraints = await MikroOrmWrapper.getManager().execute(
          `select conname from pg_constraint where conrelid = 'payphone_claim'::regclass`
        )
        const names = (constraints as { conname: string }[]).map(
          (row) => row.conname
        )
        expect(names).toEqual(
          expect.arrayContaining([
            "payphone_claim_transaction_id_key",
            "payphone_claim_status_check",
            "payphone_claim_amount_cents_check",
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
        expect(sale.payments()).toEqual([
          { orderId: "order_01RACE", transactionId: "82" },
        ])
        expect(new Set(orders.map((result) => result.orderId))).toEqual(
          new Set(["order_01RACE"])
        )

        const claims = await service.listPayphoneClaims({
          client_transaction_id: "payses_82",
        })
        expect(claims).toHaveLength(1)
        expect(claims[0]).toMatchObject({
          status: "captured",
          order_id: "order_01RACE",
          transaction_id: "82",
        })
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
        ).rejects.toThrow(PayphoneResultCode.document)

        const [pending] = await service.listPayphoneClaims({
          client_transaction_id: "payses_85",
        })
        expect(pending?.status).toBe("needs_reversal")
        expect(reverses).toBe(1)

        const deps = {
          listProcessingPastGrace: (graceSeconds: number) =>
            service.listProcessingPastGrace(graceSeconds),
          listNeedsReversal: () => service.listNeedsReversal(),
          listStaleReversing: (staleSeconds: number) =>
            service.listStaleReversing(staleSeconds),
          markNeedsReversal: (id: string, transactionId: string) =>
            service.markNeedsReversal(id, transactionId),
          claimReversal: (id: string) => service.claimReversal(id),
          markReversed: (id: string) => service.markReversed(id),
          releaseReversal: (id: string) => service.releaseReversal(id),
          captureFromReversing: (id: string, orderId: string) =>
            service.captureFromReversing(id, orderId),
          findOrderId: async () => null,
          reverse: (transactionId: number) => client.reverse(transactionId),
          graceSeconds: PROCESSING_GRACE_SECONDS,
        }
        await retryPayphoneReversals(deps)
        await retryPayphoneReversals(deps)

        expect(reverses).toBe(2)
        const [done] = await service.listPayphoneClaims({
          client_transaction_id: "payses_85",
        })
        expect(done?.status).toBe("reversed")
      })

      it("captures once when the order lands after the processing grace", async () => {
        const created = await service.ensurePending({
          clientTransactionId: "payses_slow",
          cartId: "cart_slow",
          amountCents: 3499,
          currencyCode: "usd",
        })
        expect(await service.claimProcessing(created.id)).toMatchObject({
          status: "processing",
        })
        expect(await service.attachTransactionId(created.id, "90")).toBe(
          "attached"
        )
        if (!/^[\w]+$/.test(created.id)) {
          throw new Error("unexpected claim id")
        }

        await MikroOrmWrapper.getManager().execute(
          `update "payphone_claim" set "updated_at" = now() - interval '11 minutes' where "id" = '${created.id}'`
        )

        let reverses = 0
        let orderId: string | null = null
        let releaseOrder: () => void = () => undefined
        const orderReady = new Promise<void>((resolve) => {
          releaseOrder = resolve
        })
        let jobLooking: () => void = () => undefined
        const looking = new Promise<void>((resolve) => {
          jobLooking = resolve
        })

        const job = retryPayphoneReversals({
          graceSeconds: PROCESSING_GRACE_SECONDS,
          listProcessingPastGrace: (seconds: number) =>
            service.listProcessingPastGrace(seconds),
          listNeedsReversal: () => service.listNeedsReversal(),
          listStaleReversing: (seconds: number) =>
            service.listStaleReversing(seconds),
          markNeedsReversal: (id: string, transactionId: string) =>
            service.markNeedsReversal(id, transactionId),
          claimReversal: (id: string) => service.claimReversal(id),
          markReversed: (id: string) => service.markReversed(id),
          releaseReversal: (id: string) => service.releaseReversal(id),
          captureFromReversing: (id: string, foundOrderId: string) =>
            service.captureFromReversing(id, foundOrderId),
          findOrderId: async () => {
            jobLooking()
            await orderReady
            return orderId
          },
          reverse: async () => {
            reverses += 1
          },
        })
        const order = (async () => {
          await looking
          orderId = "order_slow"
          releaseOrder()
          await service.markCaptured("payses_slow", "90", "order_slow")
        })()

        await Promise.all([job, order])

        expect(reverses).toBe(0)
        const claims = await service.listPayphoneClaims({
          client_transaction_id: "payses_slow",
        })
        expect(claims).toHaveLength(1)
        expect(claims[0]).toMatchObject({
          status: "captured",
          order_id: "order_slow",
          transaction_id: "90",
        })
      })

      it("does not reject the claim when confirm hits a network or timeout error", async () => {
        for (const [sessionId, message] of [
          ["payses_net", "network"],
          ["payses_timeout", "timeout"],
        ] as const) {
          await expect(
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
                    throw new PayphoneApiError(
                      `No se pudo contactar a PayPhone (${message}).`,
                      502
                    )
                  },
                  reverse: async () => undefined,
                },
                loadCart: async () => usdCart(sessionId.replace("payses", "cart")),
                complete: async () => ({ orderId: "order_should_not" }),
              },
              {
                sessionCartId: sessionId.replace("payses", "cart"),
                sessionId,
                currencyCode: "usd",
                initiatedAmountCents: 3499,
                payphoneTransactionId: sessionId === "payses_net" ? 86 : 87,
                sessionData: { amount_cents: 3499 },
              }
            )
          ).rejects.toMatchObject({
            message: expect.stringContaining(PayphoneResultCode.pending),
            charge: "open",
          })

          const [claim] = await service.listPayphoneClaims({
            client_transaction_id: sessionId,
          })
          expect(claim?.status).toBe("processing")
          expect(claim?.status).not.toBe("rejected")
          expect(claim?.order_id ?? null).toBeNull()
        }
      })

      it("does not advance the claim when confirm returns a forged id", async () => {
        await expect(
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
                confirm: async () => ({
                  amount: 3499,
                  clientTransactionId: "payses_ATTACKER",
                  statusCode: 3,
                  transactionStatus: "Approved",
                  transactionId: 88,
                  currency: "USD",
                }),
                reverse: async () => undefined,
              },
              loadCart: async () => usdCart("cart_forged_id"),
              complete: async () => ({ orderId: "order_should_not" }),
            },
            {
              sessionCartId: "cart_forged_id",
              sessionId: "payses_forged_id",
              currencyCode: "usd",
              initiatedAmountCents: 3499,
              payphoneTransactionId: 88,
              sessionData: { amount_cents: 3499 },
            }
          )
        ).rejects.toMatchObject({
          message: expect.stringContaining(PayphoneResultCode.pending),
          charge: "open",
        })

        const [claim] = await service.listPayphoneClaims({
          client_transaction_id: "payses_forged_id",
        })
        expect(claim).toMatchObject({
          status: "pending",
          transaction_id: null,
          order_id: null,
        })
        expect([
          "processing",
          "captured",
          "rejected",
          "needs_reversal",
          "reversing",
          "reversed",
        ]).not.toContain(claim?.status)
      })

      it("leaves every forbidden status pair unchanged", async () => {
        const created = await service.ensurePending({
          clientTransactionId: "payses_pairs",
          cartId: "cart_pairs",
          amountCents: 3499,
          currencyCode: "usd",
        })
        if (!/^[\w]+$/.test(created.id)) {
          throw new Error("unexpected claim id")
        }

        const attempts: {
          to: (typeof PAYPHONE_CLAIM_STATUSES)[number]
          run: () => Promise<unknown>
        }[] = [
          {
            to: "processing",
            run: () => service.claimProcessing(created.id),
          },
          {
            to: "pending",
            run: () => service.releaseProcessing(created.id),
          },
          {
            to: "rejected",
            run: () => service.markRejected(created.id),
          },
          {
            to: "captured",
            run: () => service.markCaptured("payses_pairs", "910", "order_x"),
          },
          {
            to: "captured",
            run: () => service.captureFromReversing(created.id, "order_x"),
          },
          {
            to: "needs_reversal",
            run: () => service.markNeedsReversal(created.id, "910"),
          },
          {
            to: "needs_reversal",
            run: () => service.releaseReversal(created.id),
          },
          {
            to: "reversing",
            run: () => service.claimReversal(created.id),
          },
          {
            to: "reversed",
            run: () => service.markReversed(created.id),
          },
        ]
        const forbidden: string[] = []

        for (const from of PAYPHONE_CLAIM_STATUSES) {
          for (const attempt of attempts) {
            if (isAllowedClaimTransition(from, attempt.to)) {
              continue
            }

            forbidden.push(`${from}->${attempt.to}`)
            await MikroOrmWrapper.getManager().execute(
              `update "payphone_claim" set "status" = '${from}', "transaction_id" = '910', "order_id" = null where "id" = '${created.id}'`
            )
            await attempt.run()

            const [row] = await service.listPayphoneClaims({ id: created.id })
            expect(row).toMatchObject({
              status: from,
              transaction_id: "910",
              order_id: null,
            })
          }
        }

        expect(forbidden).toHaveLength(50)
        expect(new Set(forbidden)).toEqual(
          new Set(
            PAYPHONE_CLAIM_STATUSES.flatMap((from) =>
              attempts
                .filter((attempt) => !isAllowedClaimTransition(from, attempt.to))
                .map((attempt) => `${from}->${attempt.to}`)
            )
          )
        )
      })

      it("reverses once when two jobs run in parallel", async () => {
        const created = await service.ensurePending({
          clientTransactionId: "payses_parallel_job",
          cartId: "cart_parallel_job",
          amountCents: 3499,
          currencyCode: "usd",
        })
        expect(await service.claimProcessing(created.id)).toMatchObject({
          status: "processing",
        })
        expect(await service.attachTransactionId(created.id, "91")).toBe(
          "attached"
        )
        expect(await service.markNeedsReversal(created.id, "91")).toMatchObject({
          status: "needs_reversal",
        })

        let reverses = 0
        let active = 0
        let maxActive = 0
        const deps = {
          graceSeconds: PROCESSING_GRACE_SECONDS,
          listProcessingPastGrace: (seconds: number) =>
            service.listProcessingPastGrace(seconds),
          listNeedsReversal: () => service.listNeedsReversal(),
          listStaleReversing: (seconds: number) =>
            service.listStaleReversing(seconds),
          markNeedsReversal: (id: string, transactionId: string) =>
            service.markNeedsReversal(id, transactionId),
          claimReversal: (id: string) => service.claimReversal(id),
          markReversed: (id: string) => service.markReversed(id),
          releaseReversal: (id: string) => service.releaseReversal(id),
          captureFromReversing: (id: string, orderId: string) =>
            service.captureFromReversing(id, orderId),
          findOrderId: async () => null,
          reverse: async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise((resolve) => setTimeout(resolve, 40))
            active -= 1
            reverses += 1
          },
        }

        await Promise.all([
          retryPayphoneReversals(deps),
          retryPayphoneReversals(deps),
        ])

        expect(reverses).toBe(1)
        expect(maxActive).toBe(1)
        const [row] = await service.listPayphoneClaims({ id: created.id })
        expect(row).toMatchObject({
          status: "reversed",
          transaction_id: "91",
        })
      })
    })
  },
})

function usdCart(id: string) {
  return {
    id,
    currencyCode: "usd",
    total: "34.99",
    taxTotal: "4.56",
    shippingTotal: 0,
    shippingTaxTotal: 0,
  }
}

function saleHarness(service: PayphoneClaimModuleService, transactionId: number) {
  let confirms = 0
  let completes = 0
  let orderId: string | null = null
  const payments: { orderId: string; transactionId: string }[] = []
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
                payments.push({
                  orderId: createdOrderId,
                  transactionId: String(transactionId),
                })
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
    payments: () => payments,
  }
}
