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
    metadata?: Record<string, unknown> | null
  } | null
}

export type InvoiceIdRemoval = {
  billing_address: {
    id?: string
    metadata: {
      tax_id: ""
      tax_id_type: ""
    }
  }
}

type CartPort = {
  listCarts: (
    filters: AbandonedCartFilters,
    config: { take: number; skip: number; relations: string[] }
  ) => Promise<AbandonedCartRecord[]>
  updateCarts: (id: string, data: InvoiceIdRemoval) => Promise<unknown>
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

  const metadata = cart.billing_address?.metadata
  if (!metadata) {
    return false
  }

  return (
    Object.prototype.hasOwnProperty.call(metadata, "tax_id") ||
    Object.prototype.hasOwnProperty.call(metadata, "tax_id_type")
  )
}

/**
 * Drops invoice ids from abandoned carts through the cart module.
 * Empty strings are Medusa's metadata delete marker. Orders are never loaded.
 * Safe to run twice: a cart with no invoice keys is skipped.
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

      const removal: InvoiceIdRemoval = {
        billing_address: {
          metadata: {
            tax_id: "",
            tax_id_type: "",
          },
        },
      }

      if (cart.billing_address?.id) {
        removal.billing_address.id = cart.billing_address.id
      }

      await port.updateCarts(cart.id, removal)
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

    // `updateCarts` may refresh `updated_at` and drop the cart from this
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
