"use server"

import { sdk } from "@lib/config"
import { isBtcpay } from "@lib/constants"
import { HttpTypes } from "@medusajs/types"
import { getAuthHeaders, getCartId } from "./cookies"

export type BtcpayPaymentState = {
  state:
    | "pending"
    | "processing"
    | "settled"
    | "expired"
    | "invalid"
    | "partial"
    | "paid_late"
    | "paid_over"
    | "limit_reached"
    | "failed"
    | "cart_changed"
    | "mismatch"
  message: string
  order_id?: string | null
  expires_at?: string | null
}

export async function getBtcpayPaymentState(cartId: string) {
  const cookieCartId = await getCartId()
  if (!cookieCartId || cookieCartId !== cartId) {
    return {
      state: "failed" as const,
      message: "No encontramos el carrito.",
    }
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cartResponse = await sdk.client
    .fetch<HttpTypes.StoreCartResponse>(`/store/carts/${cookieCartId}`, {
      method: "GET",
      query: { fields: "id,*payment_collection.payment_sessions" },
      headers,
      cache: "no-store",
    })
    .catch(() => null)
  const session = cartResponse?.cart.payment_collection?.payment_sessions?.find(
    (entry) => isBtcpay(entry.provider_id)
  )
  if (!session?.id) {
    return {
      state: "failed" as const,
      message: "Este carrito no tiene un pago con Bitcoin.",
    }
  }

  try {
    return await sdk.client.fetch<BtcpayPaymentState>("/store/btcpay/status", {
      method: "GET",
      query: {
        cart_id: cookieCartId,
        payment_session_id: session.id,
      },
      headers,
      cache: "no-store",
    })
  } catch (error) {
    if (isNotFound(error)) {
      return {
        state: "failed" as const,
        message: "No encontramos el carrito.",
      }
    }
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  )
}
