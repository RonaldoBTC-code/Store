import { HttpTypes } from "@medusajs/types"
import { parseTaxId } from "../util/ec-tax-id"

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function optionalPostal(value: string): string | null {
  return value ? value : null
}

function requirePhone(value: string, which: "Shipping" | "Billing"): string {
  if (!value) {
    throw new Error(`${which} phone is required.`)
  }

  return value
}

type AddressInput = {
  first_name: string
  last_name: string
  address_1: string
  address_2: string
  company?: string
  postal_code: string | null
  city: string
  country_code: string
  province: string
  phone: string
}

function addressFromFields(
  formData: FormData,
  prefix: "shipping_address" | "billing_address",
  which: "Shipping" | "Billing"
): AddressInput {
  return {
    first_name: field(formData, `${prefix}.first_name`),
    last_name: field(formData, `${prefix}.last_name`),
    address_1: field(formData, `${prefix}.address_1`),
    address_2: "",
    company: field(formData, `${prefix}.company`),
    postal_code: optionalPostal(field(formData, `${prefix}.postal_code`)),
    city: field(formData, `${prefix}.city`),
    country_code: field(formData, `${prefix}.country_code`),
    province: field(formData, `${prefix}.province`),
    phone: requirePhone(field(formData, `${prefix}.phone`), which),
  }
}

/**
 * Builds the cart update for checkout.
 * The invoice id is stored only on the billing address metadata so Medusa
 * copies it onto the order when the cart is completed.
 */
export function checkoutAddressesFromForm(
  formData: FormData
): HttpTypes.StoreUpdateCart {
  const shippingAddress = addressFromFields(
    formData,
    "shipping_address",
    "Shipping"
  )
  const sameAsBilling = formData.get("same_as_billing") === "on"
  const keepTaxId = formData.get("billing_address.tax_id_keep") === "on"
  const taxId = keepTaxId
    ? null
    : parseTaxId(
        field(formData, "billing_address.tax_id_type"),
        field(formData, "billing_address.tax_id")
      )

  const billingCore = sameAsBilling
    ? shippingAddress
    : addressFromFields(formData, "billing_address", "Billing")
  const billingAddress: AddressInput & {
    metadata?: ReturnType<typeof parseTaxId>
  } = {
    ...billingCore,
  }

  if (keepTaxId) {
    delete billingAddress.company
  } else if (taxId?.tax_id_type === "ruc") {
    const company = field(formData, "billing_address.company")
    if (!company) {
      throw new Error("Ingresa la razón social para facturar con RUC")
    }
    billingAddress.company = company
    billingAddress.metadata = taxId
  } else {
    billingAddress.company = ""
    if (taxId) {
      billingAddress.metadata = taxId
    }
  }

  return {
    shipping_address: shippingAddress,
    billing_address: billingAddress,
    email: field(formData, "email"),
  }
}
