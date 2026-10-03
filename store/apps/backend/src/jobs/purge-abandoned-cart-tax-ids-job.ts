import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  purgeAbandonedCartInvoiceIds,
  type AbandonedCartFilters,
  type AbandonedCartRecord,
  type InvoiceIdRemoval,
} from "./purge-abandoned-cart-tax-ids"

/**
 * Daily LOPDP retention: invoice ids stay on orders for SRI invoicing and are
 * removed from carts that were never completed and have not been updated for
 * 30 days.
 */
export default async function purgeAbandonedCartInvoiceIdsJob(
  container: MedusaContainer
) {
  const cartModule = container.resolve(Modules.CART) as unknown as {
    listCarts: (
      filters: AbandonedCartFilters,
      config: { take: number; skip: number; relations: string[] }
    ) => Promise<AbandonedCartRecord[]>
    updateCarts: (id: string, data: InvoiceIdRemoval) => Promise<unknown>
  }
  const logger = container.resolve("logger") as {
    info: (message: string) => void
  }

  await purgeAbandonedCartInvoiceIds({
    listCarts: (filters, config) => cartModule.listCarts(filters, config),
    updateCarts: (id, data) => cartModule.updateCarts(id, data),
    log: (message) => logger.info(message),
  })
}

export const config = {
  name: "purge-abandoned-cart-invoice-ids",
  schedule: "0 0 * * *",
}
