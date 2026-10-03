import { describe, expect, it } from "vitest"
import { redactTaxIdentifiers } from "./redact-tax-id"

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
