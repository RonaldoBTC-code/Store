import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialMedia from "./editorial-media"
import { PACKSHOTS } from "./packshots"

/**
 * True-alpha packshots floating on ink. Product names + alts only.
 */
const PackshotGallery = () => {
  return (
    <div className="relative z-10 mt-12 grid grid-cols-2 gap-6 px-6 small:grid-cols-4 small:gap-8 small:px-12">
      {PACKSHOTS.map((packshot) => (
        <LocalizedClientLink
          key={packshot.handle}
          href={`/products/${packshot.handle}`}
          className="group relative z-10"
        >
          <div className="relative aspect-square bg-transparent">
            <EditorialMedia
              src={packshot.png}
              fallback={packshot.png}
              alt={packshot.alt}
              objectFit="contain"
              sizes="(min-width: 1024px) 25vw, 50vw"
              className="pointer-events-none bg-transparent"
            />
          </div>
          <p className="editorial-hud mt-4 text-neon">{packshot.label}</p>
        </LocalizedClientLink>
      ))}
    </div>
  )
}

export default PackshotGallery
