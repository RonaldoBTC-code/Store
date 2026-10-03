import type { BtcpayPaymentStore } from "./payment-store"

let paymentStore: BtcpayPaymentStore | null = null

export function registerBtcpayPaymentStore(store: BtcpayPaymentStore) {
  paymentStore = store
}

export function getBtcpayPaymentStore(): BtcpayPaymentStore | null {
  return paymentStore
}
