"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders, getCartId, removeCartId } from "@lib/data/cookies"

export type PayphoneReturnResult = {
  order_id?: string
  country_code?: string
  state?: "no_charge" | "confirming" | "approved"
  code?: string
  charge?: string
  message?: string
}

export async function completePayphoneReturn(input: {
  id: string
  clientTransactionId: string
}): Promise<PayphoneReturnResult | null> {
  const cartId = await getCartId()

  try {
    const result = await sdk.client.fetch<PayphoneReturnResult>(
      "/store/payphone/complete",
      {
        method: "POST",
        body: {
          id: Number(input.id),
          client_transaction_id: input.clientTransactionId,
          ...(cartId ? { cart_id: cartId } : {}),
        },
        headers: {
          ...(await getAuthHeaders()),
        },
        cache: "no-store",
      }
    )

    if (result.order_id && /^order_[A-Za-z0-9]+$/.test(result.order_id)) {
      await removeCartId()
    }

    return result
  } catch {
    return null
  }
}
