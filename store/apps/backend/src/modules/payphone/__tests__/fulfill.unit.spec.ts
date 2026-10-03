import { PAYPHONE_PROVIDER_ID } from "../providers"
import { fulfillPayphoneSale } from "../fulfill"
import { readPayphoneNotification } from "../notification"
import type { PayphoneCompletionSession } from "../completion"

const SESSION = "payses_01HOOK"
const CART = "cart_01HOOK"

const session: PayphoneCompletionSession = {
  id: SESSION,
  amount: "34.99",
  currency_code: "usd",
  provider_id: PAYPHONE_PROVIDER_ID,
  payment_collection_id: "paycol_01",
  data: { amount_cents: 3499 },
}

describe("readPayphoneNotification", () => {
  it("rejects another store before fulfillment", () => {
    expect(
      readPayphoneNotification(
        {
          StoreId: "someone-else",
          ClientTransactionId: SESSION,
          TransactionId: 9,
        },
        "store-1"
      )
    ).toEqual({ action: "ack", errorCode: "666" })
  })
})

describe("fulfillPayphoneSale webhook", () => {
  it("completes exactly one order when only the webhook runs", async () => {
    let completes = 0
    let settles = 0
    let orderId: string | null = null
    const fulfill = () =>
      fulfillPayphoneSale(
        {
          loadSession: async () => session,
          loadCartId: async () => CART,
          findOrderId: async () => orderId,
          settle: async () => {
            settles += 1
            completes += 1
            orderId = "order_01HOOK"
            return { orderId }
          },
        },
        {
          clientTransactionId: SESSION,
          payphoneTransactionId: 9,
        }
      )

    const first = await fulfill()
    const second = await fulfill()

    expect(first).toEqual({
      ok: true,
      orderId: "order_01HOOK",
      cartId: CART,
    })
    expect(second).toEqual(first)
    expect(settles).toBe(1)
    expect(completes).toBe(1)
  })
})
