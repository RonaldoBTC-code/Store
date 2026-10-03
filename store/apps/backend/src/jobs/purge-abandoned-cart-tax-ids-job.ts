import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { purgeAbandonedCartInvoiceIds } from "./purge-abandoned-cart-tax-ids"

/**
 * Daily LOPDP retention: invoice ids stay on orders for SRI invoicing and are
 * removed from carts that were never completed and have not been updated for
 * 30 days.
 */
export default async function purgeAbandonedCartInvoiceIdsJob(
  container: MedusaContainer
) {
  const cartModule = container.resolve(Modules.CART) as {
    listCarts: (
      filters: unknown,
      config: unknown
    ) => Promise<unknown[]>
    updateCarts: (id: string, data: unknown) => Promise<unknown>
  }
  const logger = container.resolve("logger") as {
    info: (message: string) => void
  }

  await purgeAbandonedCartInvoiceIds({
    listCarts: (filters, config) =>
      cartModule.listCarts(filters, config) as ReturnType<
        typeof cartModule.listCarts
      >,
    updateCarts: (id, data) => cartModule.updateCarts(id, data),
    log: (message) => logger.info(message),
  })
}

export const config = {
  name: "purge-abandoned-cart-invoice-ids",
  schedule: "0 0 * * *",
}
