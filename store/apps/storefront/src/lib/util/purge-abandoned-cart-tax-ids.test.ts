import { describe, expect, it } from "vitest"
import {
  ABANDONED_CART_TAX_ID_BATCH_SIZE,
  ABANDONED_CART_TAX_ID_MAX_AGE_MS,
  abandonedCartListFilters,
  cartStillHoldsInvoiceId,
  purgeAbandonedCartInvoiceIds,
  type AbandonedCartFilters,
  type AbandonedCartRecord,
  type InvoiceIdRemoval,
} from "../../../../backend/src/jobs/purge-abandoned-cart-tax-ids"

const NOW = new Date("2026-10-03T00:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

type Row = AbandonedCartRecord & {
  billing_address: {
    id: string
    metadata: Record<string, unknown>
  }
}

function row(
  id: string,
  options: { days: number; completed?: boolean; tax?: boolean }
): Row {
  return {
    id,
    completed_at: options.completed ? daysAgo(40) : null,
    updated_at: daysAgo(options.days),
    billing_address: {
      id: `addr_${id}`,
      metadata: options.tax
        ? { tax_id: "secret-value", tax_id_type: "cedula", note: "keep" }
        : { note: "keep" },
    },
  }
}

function matches(cart: Row, filters: AbandonedCartFilters): boolean {
  if (filters.completed_at === null && cart.completed_at) {
    return false
  }

  const updated = cart.updated_at ? new Date(cart.updated_at) : null
  if (!updated || Number.isNaN(updated.getTime())) {
    return false
  }

  return updated.getTime() < filters.updated_at.$lt.getTime()
}

function createPort(rows: Row[], bumpUpdatedAt: boolean) {
  const updates: { id: string; data: InvoiceIdRemoval }[] = []
  const logs: string[] = []
  const orders = [
    {
      id: "order_1",
      billing_address: {
        metadata: { tax_id: "secret-value", tax_id_type: "cedula" },
      },
    },
  ]

  return {
    orders,
    updates,
    logs,
    rows,
    async listCarts(
      filters: AbandonedCartFilters,
      config: { take: number; skip: number; relations: string[] }
    ) {
      expect(config.take).toBe(ABANDONED_CART_TAX_ID_BATCH_SIZE)
      expect(config.relations).toEqual(["billing_address"])
      const matching = rows.filter((cart) => matches(cart, filters))
      return matching.slice(config.skip, config.skip + config.take)
    },
    async updateCarts(id: string, data: InvoiceIdRemoval) {
      updates.push({ id, data })
      const cart = rows.find((entry) => entry.id === id)
      if (!cart) {
        return
      }

      const metadata = { ...cart.billing_address.metadata }
      delete metadata.tax_id
      delete metadata.tax_id_type
      cart.billing_address.metadata = metadata

      if (bumpUpdatedAt) {
        cart.updated_at = NOW.toISOString()
      }
    },
    log(message: string) {
      logs.push(message)
    },
    now: NOW,
  }
}

describe("abandoned cart invoice-id retention", () => {
  it("selects incomplete carts last updated more than 30 days ago", () => {
    const filters = abandonedCartListFilters(NOW)
    expect(filters).toEqual({
      completed_at: null,
      updated_at: {
        $lt: new Date(NOW.getTime() - ABANDONED_CART_TAX_ID_MAX_AGE_MS),
      },
    })
    expect(ABANDONED_CART_TAX_ID_MAX_AGE_MS).toBe(30 * DAY)
  })

  it("ignores recent, completed, undated, and already-clean carts", () => {
    expect(
      cartStillHoldsInvoiceId(row("old", { days: 31, tax: true }), NOW)
    ).toBe(true)
    expect(
      cartStillHoldsInvoiceId(row("recent", { days: 30, tax: true }), NOW)
    ).toBe(false)
    expect(
      cartStillHoldsInvoiceId(
        row("done", { days: 40, completed: true, tax: true }),
        NOW
      )
    ).toBe(false)
    expect(
      cartStillHoldsInvoiceId(
        { ...row("blank", { days: 40, tax: true }), updated_at: null },
        NOW
      )
    ).toBe(false)
    expect(
      cartStillHoldsInvoiceId(row("clean", { days: 40, tax: false }), NOW)
    ).toBe(false)
  })

  it.each([
    ["drops carts whose updated_at moves forward", true],
    ["keeps carts in the date filter", false],
  ])("%s and still cleans every old cart once", async (_label, bumpUpdatedAt) => {
    const old = Array.from({ length: ABANDONED_CART_TAX_ID_BATCH_SIZE + 1 }, (_, index) =>
      row(`cart-old-${index}`, { days: 40, tax: true })
    )
    const recent = row("cart-recent", { days: 2, tax: true })
    const completed = row("cart-completed", {
      days: 90,
      completed: true,
      tax: true,
    })
    const boundary = row("cart-boundary", { days: 30, tax: true })
    const port = createPort([...old, recent, completed, boundary], bumpUpdatedAt)

    const cleaned = await purgeAbandonedCartInvoiceIds(port)

    expect(cleaned).toBe(old.length)
    expect(port.updates.map((update) => update.id).sort()).toEqual(
      old.map((cart) => cart.id).sort()
    )

    for (const update of port.updates) {
      expect(update.data).toEqual({
        billing_address: {
          id: `addr_${update.id}`,
          metadata: { tax_id: "", tax_id_type: "" },
        },
      })
    }

    for (const cart of old) {
      expect(cart.billing_address.metadata).toEqual({ note: "keep" })
    }

    expect(recent.billing_address.metadata.tax_id).toBe("secret-value")
    expect(completed.billing_address.metadata.tax_id).toBe("secret-value")
    expect(boundary.billing_address.metadata.tax_id).toBe("secret-value")
    expect(port.orders[0].billing_address.metadata.tax_id).toBe("secret-value")
    expect(port.logs).toEqual([
      `Abandoned cart invoice-id cleanup finished. carts_cleaned=${old.length}`,
    ])
    expect(port.logs.join("\n")).not.toContain("secret-value")
    expect(port.logs.join("\n")).not.toContain("cart-old")
    expect(port.logs.join("\n")).not.toContain("addr_")

    port.updates.length = 0
    port.logs.length = 0
    const second = await purgeAbandonedCartInvoiceIds(port)
    expect(second).toBe(0)
    expect(port.updates).toEqual([])
    expect(port.logs).toEqual([
      "Abandoned cart invoice-id cleanup finished. carts_cleaned=0",
    ])
  })

  it("does not update a completed or recent cart a bad lister still returns", async () => {
    const completed = row("cart-done", { days: 40, completed: true, tax: true })
    const recent = row("cart-new", { days: 1, tax: true })
    const updates: string[] = []

    const cleaned = await purgeAbandonedCartInvoiceIds({
      now: NOW,
      listCarts: async () => [completed, recent],
      updateCarts: async (id) => {
        updates.push(id)
      },
      log: () => undefined,
    })

    expect(cleaned).toBe(0)
    expect(updates).toEqual([])
    expect(completed.billing_address.metadata.tax_id).toBe("secret-value")
    expect(recent.billing_address.metadata.tax_id).toBe("secret-value")
  })
})
