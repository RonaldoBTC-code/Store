"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"

export type BtcpayPaymentState = {
  state: "pending" | "settled" | "failed" | "cart_changed" | "mismatch"
  message: string
  order_id?: string | null
}

export async function getBtcpayPaymentState(cartId: string) {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.client.fetch<BtcpayPaymentState>("/store/btcpay/status", {
    method: "GET",
    query: { cart_id: cartId },
    headers,
    cache: "no-store",
  })
}
