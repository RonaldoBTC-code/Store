import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

const CANONICAL_HANDLES = ["fish-hug", "lo-fi-cat", "busy-dog", "cat-online"] as const
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

type ProductRecord = {
  id: string
  handle?: string | null
  title?: string | null
  status?: string | null
}

const normalizeTitle = (title?: string | null) =>
  (title ?? "").trim().toLowerCase().replace(/\s+/g, " ")

const canonicalHandleFor = (product: ProductRecord) => {
  const handle = product.handle ?? ""
  if (CANONICAL_HANDLES.includes(handle as (typeof CANONICAL_HANDLES)[number])) {
    return handle
  }
  return TITLE_TO_HANDLE[normalizeTitle(product.title)] ?? null
}

/**
 * Unpublish leftover Medusa demo products and duplicate Gato Gang dad hats.
 * Keeps one published product per SKU: fish-hug, lo-fi-cat, busy-dog, cat-online.
 */
export default async function syncGatoGangCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "status"],
  })

  const records = (products as ProductRecord[]) ?? []
  const keep = new Map<string, ProductRecord>()
  const unpublishIds = new Set<string>()

  ;[...records]
    .sort((a, b) => {
      const aCanonical = CANONICAL_HANDLES.includes(
        (a.handle ?? "") as (typeof CANONICAL_HANDLES)[number]
      )
      const bCanonical = CANONICAL_HANDLES.includes(
        (b.handle ?? "") as (typeof CANONICAL_HANDLES)[number]
      )
      return Number(bCanonical) - Number(aCanonical)
    })
    .forEach((product) => {
      const handle = product.handle ?? ""
      if (DEMO_HANDLES.has(handle)) {
        unpublishIds.add(product.id)
        return
      }

      const canonical = canonicalHandleFor(product)
      if (!canonical) {
        return
      }

      const existing = keep.get(canonical)
      if (!existing) {
        keep.set(canonical, product)
        return
      }

      unpublishIds.add(product.id)
    })

  const toUnpublish = records.filter(
    (product) =>
      unpublishIds.has(product.id) && product.status !== ProductStatus.DRAFT
  )

  if (!toUnpublish.length) {
    logger.info(
      "Gato Gang catalog already clean (fish-hug, lo-fi-cat, busy-dog, cat-online)."
    )
    return
  }

  for (const product of toUnpublish) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: product.id },
        update: { status: ProductStatus.DRAFT },
      },
    })
    logger.info(
      `Unpublished duplicate/demo product ${product.handle ?? product.id} (${product.title}).`
    )
  }

  logger.info(
    `Catalog hygiene complete. Kept ${keep.size} canonical dad hats, unpublished ${toUnpublish.length}.`
  )
}
