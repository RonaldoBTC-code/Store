export type CartSnapshot = {
  units: number
  customerId: string | null
}

export interface CartSnapshotReader {
  read(cartId: string): Promise<CartSnapshot | null>
}

let reader: CartSnapshotReader | null = null

export function registerCartSnapshotReader(next: CartSnapshotReader) {
  reader = next
}

export function getCartSnapshotReader(): CartSnapshotReader | null {
  return reader
}

export function unitCount(items: { quantity?: unknown }[] | null | undefined): number {
  let total = 0
  for (const item of items ?? []) {
    const quantity = item?.quantity
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      continue
    }
    total += quantity
  }
  return total
}
