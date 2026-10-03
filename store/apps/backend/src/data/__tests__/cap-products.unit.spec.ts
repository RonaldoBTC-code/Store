import {
  TODO,
  capProducts,
  listInvalidCapPrices,
  listMissingCapSeedFields,
  listZeroCapStockWarnings,
  type CapSeed,
} from "../cap-products"

const filledCap = (): CapSeed => ({
  title: "Fish Hug",
  handle: "fish-hug",
  description: capProducts[0].description,
  talla: "Talla unica",
  color: "negra",
  sku: "FISH-HUG",
  priceUsd: 1,
  stockedQuantity: 0,
})

describe("cap product seed data", () => {
  it("lists every sku, price, and stock field still marked TODO", () => {
    expect(listMissingCapSeedFields()).toEqual([
      "fish-hug.sku",
      "fish-hug.priceUsd",
      "fish-hug.stockedQuantity",
      "lo-fi-cat.sku",
      "lo-fi-cat.priceUsd",
      "lo-fi-cat.stockedQuantity",
      "busy-dog.sku",
      "busy-dog.priceUsd",
      "busy-dog.stockedQuantity",
      "cat-online.sku",
      "cat-online.priceUsd",
      "cat-online.stockedQuantity",
    ])
  })

  it("accepts a catalog once the owner replaces every TODO", () => {
    expect(listMissingCapSeedFields([filledCap()])).toEqual([])
  })

  it("rejects a sku that is still the TODO sentinel", () => {
    expect(
      listMissingCapSeedFields([
        {
          ...filledCap(),
          sku: TODO,
        },
      ])
    ).toEqual(["fish-hug.sku"])
  })

  it("rejects a price that is not a finite amount greater than 0", () => {
    for (const priceUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const errors = listInvalidCapPrices([
        {
          ...filledCap(),
          sku: "FISH-HUG",
          priceUsd,
        },
      ])

      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain("sku FISH-HUG")
      expect(errors[0]).toContain("handle fish-hug")
      expect(errors[0]).toContain("greater than 0")
    }

    expect(
      listInvalidCapPrices([
        {
          ...filledCap(),
          sku: TODO,
          priceUsd: 0,
        },
      ])[0]
    ).toContain("handle fish-hug")
    expect(listInvalidCapPrices([filledCap()])).toEqual([])
  })

  it("warns when stocked quantity is 0 and stays quiet otherwise", () => {
    const warnings = listZeroCapStockWarnings([filledCap()])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("sku FISH-HUG")
    expect(warnings[0]).toContain("is 0")
    expect(
      listZeroCapStockWarnings([{ ...filledCap(), stockedQuantity: 4 }])
    ).toEqual([])
  })
})
