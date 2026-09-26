import {
  TODO,
  capProducts,
  listMissingCapSeedFields,
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
})
