import { getProductSeo } from "@lib/seo/copy"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

type ProductInfoProps = {
  product: HttpTypes.StoreProduct
}

const ProductInfo = ({ product }: ProductInfoProps) => {
  const seo = getProductSeo(product.handle, product.title)

  return (
    <div id="product-info">
      <div className="mx-auto flex flex-col gap-y-4 lg:max-w-[500px]">
        {product.collection && (
          <LocalizedClientLink
            href={`/collections/${product.collection.handle}`}
            className="editorial-hud text-neon hover:shadow-glow-sm"
          >
            {product.collection.title}
          </LocalizedClientLink>
        )}
        <Heading
          level="h1"
          className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight text-white"
          data-testid="product-title"
        >
          {seo.h1}
        </Heading>

        <Text
          className="whitespace-pre-line text-medium text-white/70"
          data-testid="product-description"
        >
          {product.description}
        </Text>
      </div>
    </div>
  )
}

export default ProductInfo
