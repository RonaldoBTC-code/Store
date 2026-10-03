import { splitInclusiveIva, toUsdCents } from "../amounts"
import { payphoneReverseAllowed } from "../reverse-window"

describe("PayPhone IVA split", () => {
  it("matches PayPhone's documented $1.15 example", () => {
    expect(splitInclusiveIva(1.15)).toEqual({
      amount: 115,
      amountWithoutTax: 0,
      amountWithTax: 100,
      tax: 15,
      service: 0,
      tip: 0,
    })
  })

  it("splits a tax-inclusive total so the cents sum exactly", () => {
    const split = splitInclusiveIva(11.5)

    expect(split).toEqual({
      amount: 1150,
      amountWithoutTax: 0,
      amountWithTax: 1000,
      tax: 150,
      service: 0,
      tip: 0,
    })
    expect(
      split.amountWithoutTax +
        split.amountWithTax +
        split.tax +
        split.service +
        split.tip
    ).toBe(split.amount)
  })

  it.each([
    [0.01, 1],
    [1, 100],
    [10, 1000],
    [10.1, 1010],
    [12.68, 1268],
    [19.99, 1999],
    [33.33, 3333],
  ])("rounds %s USD to %s cents and keeps the identity", (major, cents) => {
    expect(toUsdCents(major)).toBe(cents)

    const split = splitInclusiveIva(major)
    expect(split.amount).toBe(cents)
    expect(
      split.amountWithoutTax +
        split.amountWithTax +
        split.tax +
        split.service +
        split.tip
    ).toBe(cents)
  })

  it("keeps the identity for every cent amount up to $500", () => {
    for (let cents = 0; cents <= 50000; cents += 1) {
      const split = splitInclusiveIva(cents / 100)
      const sum =
        split.amountWithoutTax +
        split.amountWithTax +
        split.tax +
        split.service +
        split.tip

      expect(sum).toBe(cents)
      expect(split.amount).toBe(cents)
      expect(split.amountWithoutTax).toBe(0)
      expect(split.service).toBe(0)
      expect(split.tip).toBe(0)
    }
  })

  it("reads BigNumber-shaped input", () => {
    expect(toUsdCents({ value: "11.50", numeric: 11.5 })).toBe(1150)
  })

  it("rejects a negative amount", () => {
    expect(() => splitInclusiveIva(-1)).toThrow("Monto inválido")
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
