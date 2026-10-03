export type StockHold = {
  cartId: string
  invoiceId: string
  paymentSessionId: string
  units: number
}

export type StockRelease = {
  invoiceId: string
  reservationIds: string[]
}

export interface StockReserver {
  reserve(hold: StockHold): Promise<string[]>
  release(input: StockRelease): Promise<void>
}

export const noopStockReserver: StockReserver = {
  async reserve() {
    return []
  },
  async release() {
    return undefined
  },
}

let registered: StockReserver | null = null

export function registerStockReserver(reserver: StockReserver) {
  registered = reserver
}

export function getStockReserver(): StockReserver | null {
  return registered
}
