import type { BtcpayClaimStore } from "./claim"

let claimStore: BtcpayClaimStore | null = null

export function registerBtcpayClaimStore(store: BtcpayClaimStore) {
  claimStore = store
}

export function getBtcpayClaimStore(): BtcpayClaimStore | null {
  return claimStore
}
