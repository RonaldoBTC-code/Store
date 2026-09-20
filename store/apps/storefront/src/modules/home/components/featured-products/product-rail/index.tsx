import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ProductPreview from "@modules/products/components/product-preview"

type ProductRailProps = {
  collection: HttpTypes.StoreCollection
  region: HttpTypes.StoreRegion
  tone?: "light" | "dark"
}

export default async function ProductRail({
  collection,
  region,
  tone = "light",
}: ProductRailProps) {
  const {
    response: { products: pricedProducts },
  } = await listProducts({
    regionId: region.id,
    queryParams: {
      collection_id: collection.id,
      fields: "*variants.calculated_price",
    },
  })

  if (!pricedProducts) {
    return null
  }

  const isDark = tone === "dark"

  return (
    <div className="content-container py-12 small:py-24">
      <div className="mb-8 flex justify-between">
        <Text
          className={
            isDark
              ? "font-display text-3xl font-extrabold text-white"
              : "txt-xlarge"
          }
        >
          {collection.title}
        </Text>
        <LocalizedClientLink
          href={`/collections/${collection.handle}`}
          className={
            isDark
              ? "editorial-hud relative z-10 text-neon transition hover:shadow-glow-sm"
              : "text-ui-fg-interactive"
          }
        >
          View all
        </LocalizedClientLink>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-24 small:grid-cols-3 small:gap-y-36">
        {pricedProducts &&
          pricedProducts.map((product) => (
            <li key={product.id}>
              <ProductPreview
                product={product}
                region={region}
                isFeatured
                tone={tone}
              />
            </li>
          ))}
      </ul>
    </div>
  )
}
