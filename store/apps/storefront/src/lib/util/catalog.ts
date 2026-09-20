import { HttpTypes } from "@medusajs/types"
import { getPackshot } from "@modules/home/components/editorial/packshots"

export const CANONICAL_HANDLES = [
  "fish-hug",
  "lo-fi-cat",
  "busy-dog",
  "cat-online",
] as const

const DEMO_HANDLES = new Set(["t-shirt", "sweatshirt", "sweatpants", "shorts"])

const TITLE_TO_HANDLE: Record<string, (typeof CANONICAL_HANDLES)[number]> = {
  "fish hug": "fish-hug",
  "lo-fi cat": "lo-fi-cat",
  "lo fi cat": "lo-fi-cat",
  "lofi cat": "lo-fi-cat",
  "loo-fi cat": "lo-fi-cat",
  "busy dog": "busy-dog",
  "cat online": "cat-online",
}

type CatalogProduct = Pick<HttpTypes.StoreProduct, "id" | "handle" | "title">

const normalizeTitle = (title?: string | null) =>
  (title ?? "").trim().toLowerCase().replace(/\s+/g, " ")

const canonicalHandleFor = (product: CatalogProduct) => {
  const handle = product.handle ?? ""
  if (CANONICAL_HANDLES.includes(handle as (typeof CANONICAL_HANDLES)[number])) {
    return handle
  }

  return TITLE_TO_HANDLE[normalizeTitle(product.title)] ?? null
}

const rankProduct = (product: CatalogProduct) => {
  const handle = product.handle ?? ""
  if (CANONICAL_HANDLES.includes(handle as (typeof CANONICAL_HANDLES)[number])) {
    return 3
  }
  if (canonicalHandleFor(product)) {
    return 1
  }
  return 2
}

/**
 * Drop leftover Medusa demo SKUs and collapse duplicate Gato Gang entries
 * (same handle or same dad-hat title, preferring the canonical handle).
 */
export function sanitizeCatalogProducts<T extends CatalogProduct>(
  products: T[]
): T[] {
  const winners = new Map<string, T>()

  ;[...products]
    .sort((a, b) => rankProduct(b) - rankProduct(a))
    .forEach((product) => {
      const handle = product.handle ?? ""
      if (DEMO_HANDLES.has(handle)) {
        return
      }

      const canonical = canonicalHandleFor(product)
      const key = canonical ?? handle ?? product.id

      if (!winners.has(key)) {
        winners.set(key, product)
      }
    })

  const keep = new Set(Array.from(winners.values()).map((product) => product.id))
  return products.filter((product) => keep.has(product.id))
}

export function resolveProductThumbnail(
  product: Pick<HttpTypes.StoreProduct, "handle" | "thumbnail" | "images">
) {
  const packshot = getPackshot(product.handle)
  return packshot?.png || product.thumbnail || product.images?.[0]?.url || null
}

export function resolveProductGallery(
  product: Pick<HttpTypes.StoreProduct, "handle" | "images" | "thumbnail">,
  images?: HttpTypes.StoreProductImage[] | null
): HttpTypes.StoreProductImage[] {
  const packshot = getPackshot(product.handle)
  if (packshot) {
    return [
      {
        id: `packshot-${packshot.handle}`,
        url: packshot.png,
      },
    ]
  }

  const incoming = (images?.length ? images : product.images) ?? []
  return incoming.filter((image): image is HttpTypes.StoreProductImage =>
    Boolean(image?.url)
  )
}
