import { splitFromCartTotals, splitSumsToAmount, toUsdCents } from "../amounts"
import { payphoneReverseAllowed } from "../reverse-window"

describe("PayPhone cents from Medusa totals", () => {
  it("converts $34.99 and a stored tax total without recomputing IVA", () => {
    expect(toUsdCents(34.99)).toBe(3499)
    expect(toUsdCents("34.99")).toBe(3499)

    const split = splitFromCartTotals({
      total: "34.99",
      taxTotal: "4.56",
      untaxedTotal: 0,
    })

    expect(split).toEqual({
      amount: 3499,
      amountWithoutTax: 0,
      amountWithTax: 3043,
      tax: 456,
      service: 0,
      tip: 0,
    })
    expect(splitSumsToAmount(split)).toBe(true)
  })

  it("uses Medusa tax and untaxed shipping for several caps", () => {
    // 7.83 is the tax Medusa stored. This function does not apply 15%.
    const split = splitFromCartTotals({
      total: "65.00",
      taxTotal: "7.83",
      untaxedTotal: "5.00",
    })

    expect(split).toEqual({
      amount: 6500,
      amountWithoutTax: 500,
      amountWithTax: 5217,
      tax: 783,
      service: 0,
      tip: 0,
    })
    expect(splitSumsToAmount(split)).toBe(true)
  })

  it("keeps a discounted total's stored tax", () => {
    const split = splitFromCartTotals({
      total: "28.40",
      taxTotal: "3.70",
    })

    expect(split).toEqual({
      amount: 2840,
      amountWithoutTax: 0,
      amountWithTax: 2470,
      tax: 370,
      service: 0,
      tip: 0,
    })
    expect(splitSumsToAmount(split)).toBe(true)
  })

  it("rounds half a cent away from zero and still sums exactly", () => {
    expect(toUsdCents("1.005")).toBe(101)
    expect(toUsdCents("10.005")).toBe(1001)

    const split = splitFromCartTotals({
      total: "10.005",
      taxTotal: "1.005",
      untaxedTotal: "2.005",
    })

    expect(split).toEqual({
      amount: 1001,
      amountWithoutTax: 201,
      amountWithTax: 699,
      tax: 101,
      service: 0,
      tip: 0,
    })
    expect(
      split.amountWithTax + split.amountWithoutTax + split.tax
    ).toBe(split.amount)
    expect(splitSumsToAmount(split)).toBe(true)
  })

  it("matches PayPhone's $1.15 example when those totals are already stored", () => {
    const split = splitFromCartTotals({
      total: "1.15",
      taxTotal: "0.15",
      untaxedTotal: 0,
    })

    expect(split).toEqual({
      amount: 115,
      amountWithoutTax: 0,
      amountWithTax: 100,
      tax: 15,
      service: 0,
      tip: 0,
    })
    expect(splitSumsToAmount(split)).toBe(true)
  })

  it("reads BigNumber-shaped input", () => {
    expect(toUsdCents({ value: "11.50", numeric: 11.5 })).toBe(1150)
  })

  it("rejects a negative amount", () => {
    expect(() =>
      splitFromCartTotals({ total: -1, taxTotal: 0, untaxedTotal: 0 })
    ).toThrow("Monto inválido")
  })

  it("rejects a tax breakdown that exceeds the total", () => {
    expect(() =>
      splitFromCartTotals({ total: "10.00", taxTotal: "8.00", untaxedTotal: "5.00" })
    ).toThrow("El desglose de IVA no cuadra con el total")
  })
})

describe("PayPhone reverse window", () => {
  const sale = "2026-10-03T11:57:26.367"

  it("allows a reversal before 20:00 Ecuador on the same day", () => {
    const now = new Date(Date.UTC(2026, 9, 3, 23, 59, 0))

    expect(payphoneReverseAllowed(sale, now)).toBe(true)
  })

  it("allows a reversal at 20:00 Ecuador", () => {
    const now = new Date(Date.UTC(2026, 9, 4, 1, 0, 0))

    expect(payphoneReverseAllowed(sale, now)).toBe(true)
  })

  it("rejects a reversal after 20:00 Ecuador", () => {
    const now = new Date(Date.UTC(2026, 9, 4, 1, 1, 0))

    expect(payphoneReverseAllowed(sale, now)).toBe(false)
  })

  it("rejects a reversal on the next calendar day", () => {
    const now = new Date(Date.UTC(2026, 9, 4, 15, 0, 0))

    expect(payphoneReverseAllowed(sale, now)).toBe(false)
  })

  it("returns null when PayPhone did not send a date", () => {
    expect(payphoneReverseAllowed(undefined, new Date())).toBeNull()
    expect(payphoneReverseAllowed("not-a-date", new Date())).toBeNull()
  })
})
