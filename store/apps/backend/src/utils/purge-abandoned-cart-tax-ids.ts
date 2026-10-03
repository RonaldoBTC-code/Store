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

type QueryRunner = {
  raw(sql: string): Promise<unknown>
}

type CartPort = {
  listCarts: (
    filters: AbandonedCartFilters,
    config: { take: number; skip: number; relations: string[] }
  ) => Promise<AbandonedCartRecord[]>
  updateAddresses: (data: InvoiceAddressClearance) => Promise<unknown>
  /**
   * Blanks invoice fields on cart_address rows that no cart and no order
   * still reference, including rows with deleted_at set. Returns how many
   * rows the update changed.
   */
  clearUnlinkedInvoiceAddresses?: () => Promise<number>
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

  const billing = cart.billing_address
  return (
    nonEmptyTrimmed(billing?.company) ||
    nonEmptyTrimmed(billing?.metadata?.tax_id) ||
    nonEmptyTrimmed(billing?.metadata?.tax_id_type)
  )
}

/** A stored '' and a removed key are both clean. Whitespace is clean too. */
function nonEmptyTrimmed(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== ""
}

/**
 * Drops invoice ids from abandoned carts through the cart module's address
 * update. Empty strings are Medusa's metadata delete marker. The address id
 * is required so the same row is updated. `company` is set to "".
 * A cart is selected only when company, tax_id, or tax_id_type is a
 * non-empty string after trim. A missing key, a blank string, and whitespace
 * are already clean, so a second run updates nothing. Orders are never loaded.
 * Logs only the cart count.
 */
export async function purgeAbandonedCartInvoiceIds(
  port: CartPort
): Promise<number> {
  const now = port.now ?? new Date()
  const filters = abandonedCartListFilters(now)
  let skip = 0
  let cartsCleaned = 0
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
      cartsCleaned += 1
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

  const unlinkedCleared = port.clearUnlinkedInvoiceAddresses
    ? await port.clearUnlinkedInvoiceAddresses()
    : 0

  port.log(
    `Abandoned cart invoice-id cleanup finished. carts_cleaned=${cartsCleaned}`
  )

  return cartsCleaned + unlinkedCleared
}

/**
 * Invoice data left on a cart_address after the cart started pointing at a
 * new row. The row is updated in place: company is blanked and the invoice
 * metadata keys are removed. deleted_at is left as it is, and the row is not
 * deleted. A row still referenced by any cart or any order is left alone,
 * including when that cart or order is soft-deleted.
 */
export async function clearUnlinkedCartInvoiceAddresses(
  db: QueryRunner
): Promise<number> {
  const result = await db.raw(`
    UPDATE cart_address AS address
    SET
      company = '',
      metadata = COALESCE(address.metadata::jsonb, '{}'::jsonb)
        - 'tax_id'
        - 'tax_id_type',
      updated_at = NOW()
    WHERE (
      btrim(COALESCE(address.company, '')) <> ''
      OR (
        jsonb_typeof(COALESCE(address.metadata::jsonb, '{}'::jsonb)->'tax_id') = 'string'
        AND btrim(address.metadata->>'tax_id') <> ''
      )
      OR (
        jsonb_typeof(COALESCE(address.metadata::jsonb, '{}'::jsonb)->'tax_id_type') = 'string'
        AND btrim(address.metadata->>'tax_id_type') <> ''
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM cart
      WHERE cart.billing_address_id = address.id
         OR cart.shipping_address_id = address.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "order"
      WHERE "order".billing_address_id = address.id
         OR "order".shipping_address_id = address.id
    )
    RETURNING address.id
  `)

  return updatedRowCount(result)
}

export function updatedRowCount(result: unknown): number {
  if (Array.isArray(result)) {
    const rows = result[0]
    return Array.isArray(rows) ? rows.length : 0
  }

  if (!result || typeof result !== "object") {
    return 0
  }

  const record = result as { rowCount?: unknown; rows?: unknown }
  if (typeof record.rowCount === "number") {
    return record.rowCount
  }

  return Array.isArray(record.rows) ? record.rows.length : 0
}
