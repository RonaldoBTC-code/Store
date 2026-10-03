import { describe, expect, it } from "vitest"
import {
  applyBillingTaxId,
  CONSUMIDOR_FINAL_TAX_ID,
  isValidCedula,
  isValidRuc,
  normalizeTaxMetadata,
} from "../../../../backend/src/utils/ec-tax-id"
import {
  installStoreTaxIdSanitizer,
  isStoreApiPath,
  sanitizeStoreResponse,
  stripPublicTaxIdentifiers,
} from "../../../../backend/src/utils/strip-public-tax-id"
import {
  isValidCedula as storefrontCedula,
  isValidRuc as storefrontRuc,
} from "./ec-tax-id"

const SHARED_IDS = [
  "1710034065",
  "3012345678",
  "1710034066",
  "1710034065001",
  "1790085783001",
  "1790085784001",
  "1260004800001",
  "9999999999999",
]

describe("backend tax id rules", () => {
  it("matches the storefront check digits", () => {
    for (const id of SHARED_IDS) {
      expect(isValidCedula(id)).toBe(storefrontCedula(id))
      expect(isValidRuc(id)).toBe(storefrontRuc(id))
    }
  })

  it("rejects a bad cédula without repeating the number", () => {
    const submitted = "1710034066"
    const result = normalizeTaxMetadata({
      tax_id_type: "cedula",
      tax_id: submitted,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).not.toContain(submitted)
    }
  })

  it("stores consumidor final as the canonical id", () => {
    const body = {
      billing_address: {
        city: "Quito",
        metadata: {
          tax_id_type: "consumidor_final",
          tax_id: "1710034065",
          note: "keep",
        },
      },
      shipping_address: {
        metadata: { tax_id: "1710034065", tax_id_type: "cedula" },
      },
    }

    expect(applyBillingTaxId(body)).toBeNull()
    expect(body.billing_address.metadata).toEqual({
      tax_id_type: "consumidor_final",
      tax_id: CONSUMIDOR_FINAL_TAX_ID,
      note: "keep",
    })
    expect(body.shipping_address.metadata).toEqual({})
  })

  it("leaves a stored id in place when metadata is omitted", () => {
    expect(applyBillingTaxId({ region_id: "reg_ec" })).toBeNull()
    expect(
      applyBillingTaxId({ billing_address: { city: "Quito" } })
    ).toBeNull()
    const message = applyBillingTaxId({
      billing_address: { metadata: {} },
    })
    expect(message).toBeTruthy()
    expect(message).not.toMatch(/\d{6,}/)
  })
})

describe("stripPublicTaxIdentifiers", () => {
  it("removes invoice ids from store cart and order payloads", () => {
    const payload = {
      order: {
        id: "order_1",
        metadata: { source: "web" },
        items: [{ metadata: { gift: true } }],
        billing_address: {
          city: "Quito",
          metadata: {
            tax_id: "secret-value",
            tax_id_type: "cedula",
            note: "keep",
          },
        },
        shipping_address: {
          metadata: { tax_id: "other-secret", tax_id_type: "ruc" },
        },
      },
    }

    const stripped = stripPublicTaxIdentifiers(payload)

    expect(stripped.order.billing_address.metadata).toEqual({
      note: "keep",
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(stripped.order.shipping_address.metadata).toEqual({
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(stripped.order.metadata).toEqual({ source: "web" })
    expect(stripped.order.items[0].metadata).toEqual({ gift: true })
    expect(payload.order.billing_address.metadata.tax_id).toBe("secret-value")
    expect(JSON.stringify(stripped)).not.toContain("secret-value")
    expect(JSON.stringify(stripped)).not.toContain("other-secret")
  })

  it("replaces a final-consumer id with a kind flag and leaves empty keys unset", () => {
    const finalConsumer = stripPublicTaxIdentifiers({
      metadata: { tax_id: "secret-value", tax_id_type: "consumidor_final" },
    })
    const empty = stripPublicTaxIdentifiers({
      metadata: { tax_id: "", tax_id_type: "", note: "keep" },
    })

    expect(finalConsumer.metadata).toEqual({
      tax_id_set: true,
      tax_id_kind: "consumidor_final",
    })
    expect(empty.metadata).toEqual({ note: "keep", tax_id_set: false })
    expect(JSON.stringify(finalConsumer)).not.toContain("secret-value")
  })

  it("is idempotent once the number is gone", () => {
    const once = stripPublicTaxIdentifiers({
      metadata: { tax_id: "secret-value", tax_id_type: "cedula", note: "keep" },
    })
    expect(stripPublicTaxIdentifiers(once)).toEqual(once)
  })
})

describe("store response sanitizer", () => {
  const secret = "secret-value"

  function invoiceBody() {
    return {
      cart: {
        billing_address: {
          metadata: {
            tax_id: secret,
            tax_id_type: "cedula",
            note: "keep",
          },
        },
      },
    }
  }

  it("strips expanded billing metadata on cart field queries", () => {
    for (const url of [
      "/store/carts/cart_1?fields=*billing_address.metadata",
      "/store/carts/cart_1?fields=+billing_address.*",
    ]) {
      const stripped = sanitizeStoreResponse(url, invoiceBody())
      expect(stripped.cart.billing_address.metadata).toEqual({
        note: "keep",
        tax_id_set: true,
        tax_id_kind: "identificado",
      })
      expect(JSON.stringify(stripped)).not.toContain(secret)
    }
  })

  it("strips invoice ids nested in error bodies", () => {
    const stripped = sanitizeStoreResponse("/store/carts/cart_1", {
      type: "invalid_data",
      message: "The cart could not be completed.",
      cart: invoiceBody().cart,
    })

    expect(stripped.message).toBe("The cart could not be completed.")
    expect(stripped.cart.billing_address.metadata).toEqual({
      note: "keep",
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(JSON.stringify(stripped)).not.toContain(secret)
  })

  it("strips payment collection and customer address metadata", () => {
    const payment = sanitizeStoreResponse("/store/payment-collections/pay_1", {
      payment_collection: {
        payment_sessions: [
          {
            data: {
              metadata: { tax_id: secret, tax_id_type: "ruc" },
            },
          },
        ],
      },
    })
    const customer = sanitizeStoreResponse("/store/customers/me", {
      customer: {
        addresses: [
          {
            metadata: { tax_id: secret, tax_id_type: "cedula", label: "home" },
          },
          { metadata: { note: "no invoice key" } },
        ],
      },
    })
    const addressBook = sanitizeStoreResponse(
      "/store/customers/me/addresses",
      {
        addresses: [
          { metadata: { tax_id: secret, tax_id_type: "cedula" } },
        ],
      }
    )

    expect(
      payment.payment_collection.payment_sessions[0].data.metadata
    ).toEqual({
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(customer.customer.addresses[0].metadata).toEqual({
      label: "home",
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(customer.customer.addresses[1].metadata).toEqual({
      note: "no invoice key",
    })
    expect(addressBook.addresses[0].metadata).toEqual({
      tax_id_set: true,
      tax_id_kind: "identificado",
    })
    expect(JSON.stringify(payment)).not.toContain(secret)
    expect(JSON.stringify(customer)).not.toContain(secret)
    expect(JSON.stringify(addressBook)).not.toContain(secret)
  })

  it("leaves admin and non-store paths unchanged", () => {
    const payload = {
      order: {
        billing_address: {
          metadata: { tax_id: secret, tax_id_type: "cedula" },
        },
      },
    }

    expect(isStoreApiPath("/store")).toBe(true)
    expect(isStoreApiPath("/store/carts/cart_1")).toBe(true)
    expect(isStoreApiPath("/store-backup/carts")).toBe(false)
    expect(isStoreApiPath("/admin/orders/order_1")).toBe(false)

    const admin = sanitizeStoreResponse("/admin/orders/order_1", payload)
    const other = sanitizeStoreResponse("/store-backup/carts", payload)

    expect(admin.order.billing_address.metadata.tax_id).toBe(secret)
    expect(other).toBe(payload)
  })

  it("covers json, send, end, and write, and leaves buffers alone", () => {
    const sent: unknown[] = []
    const res = {
      json(body?: unknown) {
        return this.send(JSON.stringify(body))
      },
      send(body?: unknown) {
        sent.push(body)
        return body
      },
      end(chunk?: unknown) {
        sent.push(chunk)
        return chunk
      },
      write(chunk?: unknown) {
        sent.push(chunk)
        return true
      },
    }

    installStoreTaxIdSanitizer(res)

    res.json(invoiceBody())
    res.send(invoiceBody())
    res.send(JSON.stringify(invoiceBody()))
    res.end(JSON.stringify(invoiceBody()))
    res.write(JSON.stringify(invoiceBody()))
    res.end()

    const buffer = Buffer.from(JSON.stringify(invoiceBody()))
    res.send(buffer)

    const parsed = sent.slice(0, 5).map((entry) =>
      typeof entry === "string" ? JSON.parse(entry) : entry
    )

    for (const entry of parsed) {
      expect(entry.cart.billing_address.metadata).toEqual({
        note: "keep",
        tax_id_set: true,
        tax_id_kind: "identificado",
      })
      expect(JSON.stringify(entry)).not.toContain(secret)
    }

    expect(sent[5]).toBeUndefined()
    expect(sent[6]).toBe(buffer)
  })
})

const TEST_CEDULA = "1710034065"
const TEST_RUC = "1790085783001"
const FIELD_QUERIES = [
  "",
  "?fields=*billing_address.metadata",
  "?fields=+billing_address.*",
]

function digitRuns(serialized: string): string[] {
  return serialized.match(/\d{10,}/g) ?? []
}

function runsMatchingTaxId(serialized: string, taxId: string): string[] {
  return digitRuns(serialized).filter(
    (run) => run.includes(taxId) || taxId.includes(run)
  )
}

function hitStoreRoute(url: string, body: unknown): string {
  let sent = ""
  const res = {
    json(payload?: unknown) {
      return this.send(JSON.stringify(payload))
    },
    send(payload?: unknown) {
      sent = typeof payload === "string" ? payload : JSON.stringify(payload)
      return payload
    },
  }

  installStoreTaxIdSanitizer(res)
  res.json(body)
  return sent
}

describe("store routes do not serialize the cart tax id", () => {
  it("drops every 10-digit run of the test cédula and RUC", () => {
    const hits: string[] = []

    for (const [taxId, type] of [
      [TEST_CEDULA, "cedula"],
      [TEST_RUC, "ruc"],
    ] as const) {
      const update = {
        billing_address: {
          city: "Quito",
          phone: "0991234567",
          metadata: {
            tax_id: taxId,
            tax_id_type: type,
            note: "keep",
          },
        },
        shipping_address: {
          city: "Quito",
          phone: "0991234567",
          metadata: { tax_id: taxId, tax_id_type: type },
        },
      }
      expect(applyBillingTaxId(update)).toBeNull()

      const cart = { id: "cart_1", email: "ana@example.com", ...update }
      const order = {
        id: "order_1",
        email: cart.email,
        billing_address: cart.billing_address,
        shipping_address: cart.shipping_address,
      }
      const address = {
        id: "addr_1",
        city: "Quito",
        phone: "0991234567",
        metadata: { tax_id: taxId, tax_id_type: type, label: "home" },
      }
      const payment = {
        payment_collection: {
          id: "pay_1",
          payment_sessions: [
            { data: { metadata: { tax_id: taxId, tax_id_type: type } } },
          ],
        },
        cart,
      }
      const errorBody = {
        type: "invalid_data",
        message: "The cart could not be completed.",
        cart,
      }
      const bodies = [
        { path: "/store/carts/cart_1", body: { cart } },
        {
          path: "/store/carts/cart_1/complete",
          body: { type: "order", order },
        },
        { path: "/store/orders/order_1", body: { order } },
        { path: "/store/orders", body: { orders: [order] } },
        { path: "/store/payment-collections/pay_1", body: payment },
        {
          path: "/store/customers/me",
          body: { customer: { addresses: [address] } },
        },
        { path: "/store/customers/me/addresses", body: { addresses: [address] } },
        { path: "/store/carts/cart_1", body: errorBody },
      ]

      for (const query of FIELD_QUERIES) {
        for (const entry of bodies) {
          const url = `${entry.path}${query}`
          const raw = JSON.stringify(entry.body)
          expect(runsMatchingTaxId(raw, taxId).length).toBeGreaterThan(0)

          const serialized = hitStoreRoute(url, entry.body)

          expect(isStoreApiPath(url)).toBe(true)
          expect(runsMatchingTaxId(serialized, taxId)).toEqual([])
          expect(serialized).toContain('"tax_id_set":true')
          expect(serialized).toContain('"tax_id_kind":"identificado"')
          expect(serialized).toContain("0991234567")
          hits.push(`${type} ${url}`)
        }
      }
    }

    expect(hits).toHaveLength(FIELD_QUERIES.length * 8 * 2)
  })
})
