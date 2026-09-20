import { Text, clx } from "@modules/common/components/ui"
import { VariantPrice } from "types/global"

export default async function PreviewPrice({
  price,
  tone = "light",
}: {
  price: VariantPrice
  tone?: "light" | "dark"
}) {
  if (!price) {
    return null
  }

  return (
    <>
      {price.price_type === "sale" && (
        <Text
          className={
            tone === "dark"
              ? "line-through text-white/35"
              : "line-through text-ui-fg-muted"
          }
          data-testid="original-price"
        >
          {price.original_price}
        </Text>
      )}
      <Text
        className={clx(
          tone === "dark" ? "text-neon" : "text-ui-fg-muted",
          {
            "text-ui-fg-interactive":
              tone !== "dark" && price.price_type === "sale",
          }
        )}
        data-testid="price"
      >
        {price.calculated_price}
      </Text>
    </>
  )
}
