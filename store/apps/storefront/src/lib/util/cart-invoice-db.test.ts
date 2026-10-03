import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import {
  cartCompletionRejection,
  cartUpdateRejection,
  CONSUMIDOR_FINAL_TAX_ID,
} from "../../../../backend/src/utils/ec-tax-id"

type AddressRow = {
  cart_id: string
  kind: string
  phone: string | null
  postal_code: string | null
  metadata: string | null
}

type CartUpdate = {
  id: string
  shipping_address?: Record<string, unknown> | null
  billing_address?: Record<string, unknown> | null
}

function openDb() {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    CREATE TABLE cart_address (
      cart_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      phone TEXT,
      postal_code TEXT,
      metadata TEXT,
      PRIMARY KEY (cart_id, kind)
    );
    CREATE TABLE "order" (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL,
      billing_metadata TEXT
    );
  `)
  return db
}

function rows(db: DatabaseSync): AddressRow[] {
  return db
    .prepare(
      "SELECT cart_id, kind, phone, postal_code, metadata FROM cart_address ORDER BY kind"
    )
    .all() as AddressRow[]
}

function orders(db: DatabaseSync) {
  return db
    .prepare('SELECT id, cart_id, billing_metadata FROM "order"')
    .all() as { id: string; cart_id: string; billing_metadata: string }[]
}

/**
 * Same gate the updateCartWorkflow hook uses before updateCartsStep.
 * Only a payload that already passes is inserted.
 */
function persistCartUpdate(db: DatabaseSync, input: CartUpdate) {
  const message = cartUpdateRejection(input)
  if (message) {
    throw new Error(message)
  }

  const write = db.prepare(`
    INSERT INTO cart_address (cart_id, kind, phone, postal_code, metadata)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cart_id, kind) DO UPDATE SET
      phone = excluded.phone,
      postal_code = excluded.postal_code,
      metadata = excluded.metadata
  `)

  for (const kind of ["shipping", "billing"] as const) {
    const key = kind === "shipping" ? "shipping_address" : "billing_address"
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue
    }
    const address = input[key]
    if (!address) {
      continue
    }
    write.run(
      input.id,
      kind,
      typeof address.phone === "string" ? address.phone : null,
      address.postal_code === undefined ? null : address.postal_code,
      address.metadata === undefined ? null : JSON.stringify(address.metadata)
    )
  }
}

function cartFromDb(db: DatabaseSync, cartId: string) {
  const stored = rows(db).filter((row) => row.cart_id === cartId)
  const cart: Record<string, unknown> = { id: cartId }

  for (const row of stored) {
    const key = row.kind === "billing" ? "billing_address" : "shipping_address"
    cart[key] = {
      phone: row.phone,
      postal_code: row.postal_code,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }
  }

  return cart
}

function persistOrder(db: DatabaseSync, cartId: string) {
  const cart = cartFromDb(db, cartId)
  const message = cartCompletionRejection(cart)
  if (message) {
    throw new Error(message)
  }

  const billing = cart.billing_address as { metadata?: unknown }
  db.prepare(
    'INSERT INTO "order" (id, cart_id, billing_metadata) VALUES (?, ?, ?)'
  ).run("order_1", cartId, JSON.stringify(billing.metadata))
}

const CEDULA = "1710034065"

describe("cart invoice rows", () => {
  it("writes the normalized payload and leaves the row unchanged when input is rejected", () => {
    const db = openDb()
    const stored = {
      id: "cart_1",
      shipping_address: {
        phone: "0991234567",
        postal_code: null,
      },
      billing_address: {
        phone: "0991234567",
        postal_code: null,
        metadata: {
          tax_id_type: "cedula",
          tax_id: CEDULA,
          note: "keep",
        },
      },
    }

    persistCartUpdate(db, stored)

    expect(rows(db)).toEqual([
      {
        cart_id: "cart_1",
        kind: "billing",
        phone: "0991234567",
        postal_code: null,
        metadata: JSON.stringify(stored.billing_address.metadata),
      },
      {
        cart_id: "cart_1",
        kind: "shipping",
        phone: "0991234567",
        postal_code: null,
        metadata: null,
      },
    ])

    const rejected = [
      {
        ...stored,
        billing_address: {
          ...stored.billing_address,
          metadata: {
            tax_id_type: "cedula",
            tax_id: "1710-034065",
          },
        },
      },
      {
        ...stored,
        billing_address: {
          ...stored.billing_address,
          metadata: {
            tax_id_type: "consumidor_final",
            tax_id: CEDULA,
          },
        },
      },
      {
        ...stored,
        shipping_address: {
          phone: "0991234567",
          metadata: { tax_id: CEDULA, tax_id_type: "cedula" },
        },
      },
      {
        ...stored,
        shipping_address: { phone: "   ", postal_code: null },
      },
    ]

    for (const update of rejected) {
      expect(() => persistCartUpdate(db, update)).toThrow()
    }

    expect(rows(db)[0].metadata).toBe(
      JSON.stringify(stored.billing_address.metadata)
    )
    expect(rows(db)[1].metadata).toBeNull()

    persistCartUpdate(db, {
      ...stored,
      billing_address: {
        phone: "0991234567",
        postal_code: "",
        metadata: {
          tax_id_type: "consumidor_final",
          tax_id: CONSUMIDOR_FINAL_TAX_ID,
          note: "keep",
        },
      },
    })

    const billing = rows(db).find((row) => row.kind === "billing")
    expect(JSON.parse(billing?.metadata ?? "")).toEqual({
      tax_id_type: "consumidor_final",
      tax_id: CONSUMIDOR_FINAL_TAX_ID,
      note: "keep",
    })
    expect(billing?.postal_code).toBe("")

    expect(cartCompletionRejection(cartFromDb(db, "cart_1"))).toBeNull()
    persistOrder(db, "cart_1")
    expect(orders(db)).toHaveLength(1)
    expect(JSON.parse(orders(db)[0].billing_metadata).tax_id).toBe(
      CONSUMIDOR_FINAL_TAX_ID
    )

    db.prepare(
      "UPDATE cart_address SET metadata = ? WHERE cart_id = ? AND kind = 'billing'"
    ).run(
      JSON.stringify({ tax_id_type: "cedula", tax_id: "1710-034065" }),
      "cart_1"
    )

    expect(() => persistOrder(db, "cart_1")).toThrow()
    expect(orders(db)).toHaveLength(1)
    expect(JSON.parse(orders(db)[0].billing_metadata).tax_id).toBe(
      CONSUMIDOR_FINAL_TAX_ID
    )
  })
})
