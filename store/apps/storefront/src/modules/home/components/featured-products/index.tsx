import { HttpTypes } from "@medusajs/types"
import ProductRail from "@modules/home/components/featured-products/product-rail"

export default async function FeaturedProducts({
  collections,
  region,
  tone = "light",
}: {
  collections: HttpTypes.StoreCollection[]
  region: HttpTypes.StoreRegion
  tone?: "light" | "dark"
}) {
  return collections.map((collection) => (
    <li key={collection.id}>
      <ProductRail collection={collection} region={region} tone={tone} />
    </li>
  ))
}
