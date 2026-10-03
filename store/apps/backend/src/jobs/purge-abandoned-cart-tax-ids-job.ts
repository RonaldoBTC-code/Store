import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  clearUnlinkedCartInvoiceAddresses,
  purgeAbandonedCartInvoiceIds,
  type AbandonedCartFilters,
  type AbandonedCartRecord,
  type InvoiceAddressClearance,
} from "../utils/purge-abandoned-cart-tax-ids"

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
    updateAddresses: (data: InvoiceAddressClearance) => Promise<unknown>
  }
  const logger = container.resolve("logger") as {
    info: (message: string) => void
  }
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    raw(sql: string): Promise<unknown>
  }

  return purgeAbandonedCartInvoiceIds({
    listCarts: (filters, config) => cartModule.listCarts(filters, config),
    updateAddresses: (data) => cartModule.updateAddresses(data),
    clearUnlinkedInvoiceAddresses: () => clearUnlinkedCartInvoiceAddresses(pg),
    log: (message) => logger.info(message),
  })
}

export const config = {
  name: "purge-abandoned-cart-invoice-ids",
  schedule: "0 0 * * *",
}
