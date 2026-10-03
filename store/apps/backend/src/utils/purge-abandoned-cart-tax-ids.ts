export const ABANDONED_CART_TAX_ID_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const ABANDONED_CART_TAX_ID_BATCH_SIZE = 100

export type AbandonedCartFilters = {
  completed_at: null
  updated_at: { $lt: Date }
}

export type AbandonedCartRecord = {
  id: string
  completed_at?: string | Date | null
  updated_at?: string | Date | null
  billing_address?: {
    id?: string
    company?: string | null
    metadata?: Record<string, unknown> | null
  } | null
}

/**
 * Written with the cart module's address update, not a nested cart update.
 * A nested `billing_address` on `updateCarts` leaves the old metadata in place.
 * `""` is the metadata delete marker, and the address id updates that same row.
 */
export type InvoiceAddressClearance = {
  id: string
  company: ""
  metadata: {
    tax_id: ""
    tax_id_type: ""
  }
}

type CartPort = {
  listCarts: (
    filters: AbandonedCartFilters,
    config: { take: number; skip: number; relations: string[] }
  ) => Promise<AbandonedCartRecord[]>
  updateAddresses: (data: InvoiceAddressClearance) => Promise<unknown>
  log: (message: string) => void
  now?: Date
}

export function abandonedCartListFilters(now: Date): AbandonedCartFilters {
  return {
    completed_at: null,
    updated_at: {
      $lt: new Date(now.getTime() - ABANDONED_CART_TAX_ID_MAX_AGE_MS),
    },
  }
}

export function cartStillHoldsInvoiceId(
  cart: AbandonedCartRecord,
  now: Date
): boolean {
  if (cart.completed_at) {
    return false
  }

  const updatedAt = cart.updated_at ? new Date(cart.updated_at) : null
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
    return false
  }

  const cutoff = now.getTime() - ABANDONED_CART_TAX_ID_MAX_AGE_MS
  if (updatedAt.getTime() >= cutoff) {
    return false
  }

  const company = cart.billing_address?.company
  if (typeof company === "string" && company !== "") {
    return true
  }

  const metadata = cart.billing_address?.metadata
  if (!metadata) {
    return false
  }

  return invoiceMetadataStillSet(metadata, "tax_id") ||
    invoiceMetadataStillSet(metadata, "tax_id_type")
}

function invoiceMetadataStillSet(
  metadata: Record<string, unknown>,
  key: string
): boolean {
  if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
    return false
  }

  const value = metadata[key]
  if (typeof value !== "string") {
    return value != null
  }

  return value.trim() !== ""
}

/**
 * Drops invoice ids from abandoned carts through the cart module's address
 * update. Empty strings are Medusa's metadata delete marker. The address id
 * is required so the same row is updated. `company` is set to "".
 * Carts whose billing company is non-empty are cleaned even when they have
 * no invoice metadata. Orders are never loaded. A cart with neither an
 * invoice key nor a company is skipped, so a second run updates nothing.
 * Logs only the count.
 */
export async function purgeAbandonedCartInvoiceIds(
  port: CartPort
): Promise<number> {
  const now = port.now ?? new Date()
  const filters = abandonedCartListFilters(now)
  let skip = 0
  let cleaned = 0
  const cleanedIds = new Set<string>()

  for (let pass = 0; pass < 10000; pass++) {
    const batch = await port.listCarts(filters, {
      take: ABANDONED_CART_TAX_ID_BATCH_SIZE,
      skip,
      relations: ["billing_address"],
    })

    if (batch.length === 0) {
      break
    }

    let cleanedThisPage = 0

    for (const cart of batch) {
      if (cleanedIds.has(cart.id) || !cartStillHoldsInvoiceId(cart, now)) {
        continue
      }

      const addressId = cart.billing_address?.id
      if (!addressId) {
        continue
      }

      const removal: InvoiceAddressClearance = {
        id: addressId,
        company: "",
        metadata: {
          tax_id: "",
          tax_id_type: "",
        },
      }

      await port.updateAddresses(removal)
      cleanedIds.add(cart.id)
      cleaned += 1
      cleanedThisPage += 1
    }

    if (batch.length < ABANDONED_CART_TAX_ID_BATCH_SIZE) {
      break
    }

    if (cleanedThisPage === 0) {
      skip += batch.length
      continue
    }

    // An address update may refresh `updated_at` and drop the cart from this
    // filter. The page we just held still contains those ids, so compare a
    // fresh first page. If a cleaned cart disappeared, read from the start.
    // If it is still listed, advance. Otherwise a date bump skips the next
    // carts, and an unchanged date loops on the same page.
    const probe = await port.listCarts(filters, {
      take: ABANDONED_CART_TAX_ID_BATCH_SIZE,
      skip: 0,
      relations: ["billing_address"],
    })
    const probeIds = new Set(probe.map((cart) => cart.id))
    const cleanedDroppedOut = batch.some(
      (cart) => cleanedIds.has(cart.id) && !probeIds.has(cart.id)
    )

    skip = cleanedDroppedOut ? 0 : skip + batch.length
  }

  port.log(
    `Abandoned cart invoice-id cleanup finished. carts_cleaned=${cleaned}`
  )

  return cleaned
}
