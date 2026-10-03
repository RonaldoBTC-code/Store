import { describe, expect, it } from "vitest"
import {
  CONSUMIDOR_FINAL_TAX_ID,
  formatTaxIdLabel,
  isValidCedula,
  isValidRuc,
  parseTaxId,
  publicTaxIdState,
  taxIdReviewLabel,
} from "./ec-tax-id"

describe("cédula", () => {
  it("accepts a known valid cédula and a province-30 cédula", () => {
    expect(isValidCedula("1710034065")).toBe(true)
    expect(isValidCedula("3012345678")).toBe(true)
    expect(isValidCedula("1710 0340-65")).toBe(true)
  })

  it("rejects bad length, province, third digit, and check digit", () => {
    expect(isValidCedula("171003406")).toBe(false)
    expect(isValidCedula("17100340655")).toBe(false)
    expect(isValidCedula("9910034065")).toBe(false)
    expect(isValidCedula("1760000008")).toBe(false)
    expect(isValidCedula("1710034066")).toBe(false)
    expect(isValidCedula("abcdefghij")).toBe(false)
  })
})

describe("RUC", () => {
  it("accepts natural, private, and public RUC examples", () => {
    expect(isValidRuc("1710034065001")).toBe(true)
    expect(isValidRuc("1790085783001")).toBe(true)
    expect(isValidRuc("1260004800001")).toBe(true)
  })

  it("rejects a zero establishment code and a cédula-length value", () => {
    expect(isValidRuc("1710034065000")).toBe(false)
    expect(isValidRuc("1710034065")).toBe(false)
    expect(isValidRuc("1790085784001")).toBe(false)
    expect(isValidRuc(CONSUMIDOR_FINAL_TAX_ID)).toBe(false)
  })
})

describe("parseTaxId", () => {
  it("stores a normalized cédula without echoing it in errors", () => {
    expect(parseTaxId("cedula", "1710-034065")).toEqual({
      tax_id_type: "cedula",
      tax_id: "1710034065",
    })

    const submitted = "1234567890"
    expect(() => parseTaxId("cedula", submitted)).toThrow(
      "La cédula no es válida. Revisa que tenga 10 dígitos."
    )

    try {
      parseTaxId("cedula", submitted)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message.includes(submitted)).toBe(false)
    }
  })

  it("stores the SRI consumidor final id", () => {
    expect(parseTaxId("consumidor_final", "")).toEqual({
      tax_id_type: "consumidor_final",
      tax_id: CONSUMIDOR_FINAL_TAX_ID,
    })
  })

  it("rejects an unknown type", () => {
    expect(() => parseTaxId("passport", "1710034065")).toThrow(
      "Elige cédula, RUC o consumidor final."
    )
  })
})

describe("form helpers", () => {
  it("never returns the invoice number", () => {
    const secret = "secret-value"
    const identified = {
      tax_id_set: true,
      tax_id_kind: "identificado",
      tax_id: secret,
    }

    expect(publicTaxIdState(identified)).toEqual({
      taxIdSet: true,
      taxIdKind: "identificado",
    })
    expect(formatTaxIdLabel(identified)).toBe("Cédula ingresada")
    expect(taxIdReviewLabel(identified)).toBe("Cédula: ingresada")
    expect(formatTaxIdLabel({ tax_id_kind: "consumidor_final" })).toBe(
      "Consumidor final"
    )
    expect(taxIdReviewLabel({ tax_id_kind: "consumidor_final" })).toBe(
      "Consumidor final"
    )
    expect(JSON.stringify(publicTaxIdState(identified))).not.toContain(secret)
    expect(formatTaxIdLabel(null)).toBeNull()
  })
})
