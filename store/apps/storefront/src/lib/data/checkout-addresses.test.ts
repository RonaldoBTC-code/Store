import { describe, expect, it } from "vitest"
import { cartUpdateRejection } from "../../../../backend/src/utils/ec-tax-id"
import { CONSUMIDOR_FINAL_TAX_ID } from "../util/ec-tax-id"
import { checkoutAddressesFromForm } from "./checkout-addresses"

function form(fields: Record<string, string>, sameAsBilling = true): FormData {
  const data = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value)
  }

  if (sameAsBilling) {
    data.set("same_as_billing", "on")
  }

  return data
}

const shipping = {
  "shipping_address.first_name": "Ana",
  "shipping_address.last_name": "Perez",
  "shipping_address.address_1": "Av. Amazonas",
  "shipping_address.city": "Quito",
  "shipping_address.country_code": "ec",
  "shipping_address.province": "Pichincha",
  "shipping_address.phone": " 0991234567 ",
  email: "ana@example.com",
  "billing_address.tax_id_type": "cedula",
  "billing_address.tax_id": "1710034065",
}

describe("checkoutAddressesFromForm", () => {
  it("requires a phone, leaves postal code empty, and stores the tax id on billing only", () => {
    const update = checkoutAddressesFromForm(form(shipping))
    const billing = update.billing_address

    expect(update.shipping_address).toMatchObject({
      phone: "0991234567",
      postal_code: null,
      city: "Quito",
    })
    expect(update.shipping_address).not.toHaveProperty("metadata")
    expect(billing).toMatchObject({
      phone: "0991234567",
      postal_code: null,
      metadata: {
        tax_id: "1710034065",
        tax_id_type: "cedula",
      },
    })
    expect(billing).toMatchObject({ company: "" })
    expect(cartUpdateRejection(update)).toBeNull()
  })

  it("keeps a provided postal code and a separate billing phone", () => {
    const update = checkoutAddressesFromForm(
      form(
        {
          ...shipping,
          "shipping_address.postal_code": "170150",
          "billing_address.first_name": "Luis",
          "billing_address.last_name": "Vega",
          "billing_address.address_1": "Calle Larga",
          "billing_address.city": "Cuenca",
          "billing_address.country_code": "ec",
          "billing_address.phone": "0987654321",
          "shipping_address.company": "Envio",
          "billing_address.tax_id_type": "ruc",
          "billing_address.tax_id": "1790085783001",
          "billing_address.company": "  Taller Norte  ",
        },
        false
      )
    )

    expect(update.shipping_address).toMatchObject({ postal_code: "170150" })
    expect(update.shipping_address).toMatchObject({ company: "Envio" })
    expect(update.billing_address).toMatchObject({
      first_name: "Luis",
      phone: "0987654321",
      city: "Cuenca",
      company: "Taller Norte",
      metadata: {
        tax_id: "1790085783001",
        tax_id_type: "ruc",
      },
    })
    expect(cartUpdateRejection(update)).toBeNull()
  })

  it("rejects a RUC without razón social", () => {
    expect(() =>
      checkoutAddressesFromForm(
        form({
          ...shipping,
          "billing_address.tax_id_type": "ruc",
          "billing_address.tax_id": "1790085783001",
          "billing_address.company": "   ",
        })
      )
    ).toThrow("Ingresa la razón social para facturar con RUC")
  })

  it("stores consumidor final without a personal number", () => {
    const update = checkoutAddressesFromForm(
      form({
        ...shipping,
        "billing_address.tax_id_type": "consumidor_final",
        "billing_address.tax_id": "",
      })
    )

    expect(update.billing_address).toMatchObject({
      company: "",
      metadata: {
        tax_id_type: "consumidor_final",
        tax_id: CONSUMIDOR_FINAL_TAX_ID,
      },
    })
  })

  it("omits metadata when the shopper keeps the stored id", () => {
    const update = checkoutAddressesFromForm(
      form({
        ...shipping,
        "billing_address.tax_id_keep": "on",
        "billing_address.tax_id": "",
      })
    )

    expect(update.billing_address).not.toHaveProperty("metadata")
    expect(update.billing_address).not.toHaveProperty("company")
    expect(JSON.stringify(update)).not.toContain("tax_id")
  })

  it("rejects a missing phone and an invalid cédula without returning the number", () => {
    expect(() =>
      checkoutAddressesFromForm(
        form({
          ...shipping,
          "shipping_address.phone": "   ",
        })
      )
    ).toThrow("Shipping phone is required.")

    const invalid = "0000000000"
    expect(() =>
      checkoutAddressesFromForm(
        form({
          ...shipping,
          "billing_address.tax_id": invalid,
        })
      )
    ).toThrow("La cédula no es válida. Revisa que tenga 10 dígitos.")

    try {
      checkoutAddressesFromForm(
        form({
          ...shipping,
          "billing_address.tax_id": invalid,
        })
      )
    } catch (error) {
      expect((error as Error).message.includes(invalid)).toBe(false)
    }
  })
})
