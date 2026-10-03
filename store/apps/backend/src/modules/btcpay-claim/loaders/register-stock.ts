import type { LoaderOptions } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  registerCartSnapshotReader,
  unitCount,
} from "../../btcpay/cart-snapshot"
import { registerStockReserver, StockReserver } from "../../btcpay/stock"

type Query = {
  graph: (args: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: Record<string, unknown>[] }>
}

type Inventory = {
  createReservationItems: (
    items: Record<string, unknown>[]
  ) => Promise<{ id: string }[]>
  deleteReservationItems: (ids: string[]) => Promise<unknown>
}

export default async function registerBtcpayStock({ container }: LoaderOptions) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query
  registerCartSnapshotReader({
    async read(cartId: string) {
      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "customer_id", "items.quantity"],
        filters: { id: cartId },
      })
      const cart = data[0]
      if (!cart) {
        return null
      }
      const customerId =
        typeof cart.customer_id === "string" && cart.customer_id
          ? cart.customer_id
          : null
      const items = Array.isArray(cart.items)
        ? (cart.items as { quantity?: unknown }[])
        : []
      return { customerId, units: unitCount(items) }
    },
  })

  let inventory: Inventory | null = null
  try {
    inventory = container.resolve(Modules.INVENTORY) as unknown as Inventory
  } catch {
    inventory = null
  }
  if (!inventory) {
    return
  }
  registerStockReserver(createInventoryReserver(query, inventory))
}

function createInventoryReserver(query: Query, inventory: Inventory): StockReserver {
  return {
    async reserve(hold) {
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "items.id",
          "items.quantity",
          "items.variant.manage_inventory",
          "items.variant.allow_backorder",
          "items.variant.inventory_items.inventory_item_id",
          "items.variant.inventory_items.required_quantity",
          "sales_channel.stock_locations.id",
        ],
        filters: { id: hold.cartId },
      })
      const cart = data[0]
      const locations = readLocations(cart?.sales_channel)
      const locationId = locations[0]
      if (!cart || !locationId) {
        return []
      }
      const items = reservationItems(cart, locationId, hold.invoiceId)
      if (!items.length) {
        return []
      }
      const created = await inventory.createReservationItems(items)
      return created.map((item) => item.id).filter((id) => Boolean(id))
    },
    async release(input) {
      if (!input.reservationIds.length) {
        return
      }
      await inventory.deleteReservationItems(input.reservationIds)
    },
  }
}

function readLocations(salesChannel: unknown): string[] {
  if (!salesChannel || typeof salesChannel !== "object") {
    return []
  }
  const locations = (salesChannel as { stock_locations?: { id?: string }[] })
    .stock_locations
  if (!Array.isArray(locations)) {
    return []
  }
  return locations
    .map((location) => location?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

function reservationItems(
  cart: Record<string, unknown>,
  locationId: string,
  invoiceId: string
): Record<string, unknown>[] {
  const lines = Array.isArray(cart.items) ? cart.items : []
  const items: Record<string, unknown>[] = []
  for (const line of lines) {
    if (!line || typeof line !== "object") {
      continue
    }
    const record = line as {
      id?: string
      quantity?: number
      variant?: {
        manage_inventory?: boolean
        allow_backorder?: boolean
        inventory_items?: { inventory_item_id?: string; required_quantity?: number }[]
      }
    }
    if (!record.variant?.manage_inventory || !record.id) {
      continue
    }
    const quantity = typeof record.quantity === "number" ? record.quantity : 0
    for (const link of record.variant.inventory_items ?? []) {
      if (!link.inventory_item_id || quantity < 1) {
        continue
      }
      const required = link.required_quantity ?? 1
      items.push({
        line_item_id: record.id,
        inventory_item_id: link.inventory_item_id,
        location_id: locationId,
        quantity: required * quantity,
        allow_backorder: Boolean(record.variant.allow_backorder),
        metadata: { btcpay_invoice_id: invoiceId },
      })
    }
  }
  return items
}
