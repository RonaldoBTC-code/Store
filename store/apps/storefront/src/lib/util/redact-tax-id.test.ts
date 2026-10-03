import { describe, expect, it } from "vitest"
import { redactRequestUrl, redactTaxIdentifiers } from "./redact-tax-id"

describe("redactTaxIdentifiers", () => {
  it("redacts nested invoice ids and leaves the original intact", () => {
    const payload = {
      billing_address: {
        city: "Quito",
        metadata: {
          tax_id: "1710034065",
          tax_id_type: "cedula",
        },
      },
      notes: ["keep"],
    }

    const logged = redactTaxIdentifiers(payload)

    expect(logged.billing_address.metadata.tax_id).toBe("[redacted]")
    expect(logged.billing_address.metadata.tax_id_type).toBe("[redacted]")
    expect(logged.billing_address.city).toBe("Quito")
    expect(payload.billing_address.metadata.tax_id).toBe("1710034065")
    expect(redactTaxIdentifiers("plain")).toBe("plain")
  })
})

describe("redactRequestUrl", () => {
  it("removes the cart id and invoice id from logged URLs", () => {
    const logged = redactRequestUrl(
      "https://api.example/store/carts/cart_01ABC?cart_id=cart_01ABC&tax_id=1710034065&fields=id"
    )

    expect(logged).not.toContain("cart_01ABC")
    expect(logged).not.toContain("1710034065")
    expect(logged).toContain("/store/carts/[redacted]")
    expect(logged).toContain("fields=id")
  })
})
