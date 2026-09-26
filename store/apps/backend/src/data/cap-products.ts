/**
 * Gato Gang cap catalog for `src/scripts/seed-cap-products.ts`.
 *
 * Titles, handles, and descriptions are copied from
 * `store/apps/storefront/src/lib/seo/copy.ts` (the same strings as
 * `seo/keyword-map-and-copy.md`). Talla and color are the size and color
 * those descriptions already state. Collection handle `gato-gang` and
 * category handle `gorras` come from `copy.ts`.
 *
 * SKU, USD price, and stocked quantity are not in the repo. They stay
 * `TODO`. The seed refuses to run until each one is replaced.
 */

export const TODO = "TODO" as const

export type Todo = typeof TODO

export const CAP_OPTION_TALLA = "Talla"
export const CAP_OPTION_COLOR = "Color"

export const capCollection = {
  title: "Gorras Gato Gang",
  handle: "gato-gang",
}

export const capCategory = {
  name: "Gorras",
  handle: "gorras",
  description:
    "Dad hats negras unisex con parche bordado en relieve. Drop 01: gatos, humor y streetwear suave.",
}

export type CapSeed = {
  title: string
  handle: string
  description: string
  /** Size stated in the product description ("Talla unica"). */
  talla: string
  /** Color stated in the product description ("negra"). */
  color: string
  /** Not in the repo. */
  sku: string | Todo
  /**
   * USD amount in major units. Retail prices are tax-inclusive (IVA 15%).
   * Not in the repo.
   */
  priceUsd: number | Todo
  /** Units at the Ecuador stock location. Not in the repo. */
  stockedQuantity: number | Todo
}

export const capProducts: CapSeed[] = [
  {
    title: "Fish Hug",
    handle: "fish-hug",
    description:
      "Dad hat negra con parche bordado del gato que abraza el pez. Street, suave y un poco picara. Talla unica unisex.",
    talla: "Talla unica",
    color: "negra",
    sku: TODO,
    priceUsd: TODO,
    stockedQuantity: TODO,
  },
  {
    title: "Lo-Fi Cat",
    handle: "lo-fi-cat",
    description:
      "Gorra negra con parche del gato lo-fi. Soundtrack propio, streetwear suave. Talla unica unisex.",
    talla: "Talla unica",
    color: "negra",
    sku: TODO,
    priceUsd: TODO,
    stockedQuantity: TODO,
  },
  {
    title: "Busy Dog",
    handle: "busy-dog",
    description:
      "Dad hat negra con parche del perro ocupado. Humor de squad, no disfraz. Regalo facil. Talla unica unisex.",
    talla: "Talla unica",
    color: "negra",
    sku: TODO,
    priceUsd: TODO,
    stockedQuantity: TODO,
  },
  {
    title: "Cat Online",
    handle: "cat-online",
    description:
      "Parche del gato en llamada, mic muteado. Companion visual de Lo-Fi Cat. Dad hat negra, talla unica.",
    talla: "Talla unica",
    color: "negra",
    sku: TODO,
    priceUsd: TODO,
    stockedQuantity: TODO,
  },
]

export function listMissingCapSeedFields(
  products: CapSeed[] = capProducts
): string[] {
  const missing: string[] = []

  for (const product of products) {
    const prefix = product.handle || product.title || "cap"

    if (
      typeof product.sku !== "string" ||
      product.sku.trim() === "" ||
      product.sku === TODO
    ) {
      missing.push(`${prefix}.sku`)
    }

    if (
      typeof product.priceUsd !== "number" ||
      !Number.isFinite(product.priceUsd) ||
      product.priceUsd < 0
    ) {
      missing.push(`${prefix}.priceUsd`)
    }

    if (
      typeof product.stockedQuantity !== "number" ||
      !Number.isInteger(product.stockedQuantity) ||
      product.stockedQuantity < 0
    ) {
      missing.push(`${prefix}.stockedQuantity`)
    }
  }

  return missing
}
