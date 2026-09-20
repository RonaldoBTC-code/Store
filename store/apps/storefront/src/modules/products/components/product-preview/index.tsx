import { Text } from "@modules/common/components/ui"
import { getProductPrice } from "@lib/util/get-product-price"
import { resolveProductThumbnail } from "@lib/util/catalog"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"
import { getPackshot } from "@modules/home/components/editorial/packshots"

export default async function ProductPreview({
  product,
  isFeatured,
  region: _region,
  tone = "dark",
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
  tone?: "light" | "dark"
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })
  const packshot = getPackshot(product.handle)
  const thumbnail = resolveProductThumbnail(product)

  return (
    <LocalizedClientLink href={`/products/${product.handle}`} className="group relative z-10">
      <div data-testid="product-wrapper">
        <Thumbnail
          thumbnail={thumbnail}
          size="full"
          isFeatured={isFeatured}
          tone={tone}
          alt={packshot?.alt ?? product.title ?? "Gato Gang dad hat"}
        />
        <div className="flex txt-compact-medium mt-4 justify-between">
          <Text
            className={tone === "dark" ? "text-white/75" : "text-ui-fg-subtle"}
            data-testid="product-title"
          >
            {product.title}
          </Text>
          <div className="flex items-center gap-x-2">
            {cheapestPrice && (
              <PreviewPrice price={cheapestPrice} tone={tone} />
            )}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
