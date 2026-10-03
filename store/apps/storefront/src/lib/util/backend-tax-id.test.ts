import { describe, expect, it } from "vitest"
import {
  applyBillingTaxId,
  CONSUMIDOR_FINAL_TAX_ID,
  isValidCedula,
  isValidRuc,
  normalizeTaxMetadata,
} from "../../../../backend/src/utils/ec-tax-id"
import { stripPublicTaxIdentifiers } from "../../../../backend/src/utils/strip-public-tax-id"
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

  it("leaves region-only updates alone and blocks a billing address without an id", () => {
    expect(applyBillingTaxId({ region_id: "reg_ec" })).toBeNull()
    const message = applyBillingTaxId({
      billing_address: { city: "Quito" },
    })
    expect(message).toBeTruthy()
    expect(message).not.toMatch(/\d{10,}/)
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
            tax_id: "1710034065",
            tax_id_type: "cedula",
            note: "keep",
          },
        },
        shipping_address: {
          metadata: { tax_id: "1790085783001", tax_id_type: "ruc" },
        },
      },
    }

    const stripped = stripPublicTaxIdentifiers(payload)

    expect(stripped.order.billing_address.metadata).toEqual({ note: "keep" })
    expect(stripped.order.shipping_address.metadata).toEqual({})
    expect(stripped.order.metadata).toEqual({ source: "web" })
    expect(stripped.order.items[0].metadata).toEqual({ gift: true })
    expect(payload.order.billing_address.metadata.tax_id).toBe("1710034065")
    expect(JSON.stringify(stripped)).not.toContain("1710034065")
    expect(JSON.stringify(stripped)).not.toContain("1790085783001")
  })
})
