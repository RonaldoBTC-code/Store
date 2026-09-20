import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialMedia from "./editorial-media"
import { PACKSHOTS } from "./packshots"

/**
 * Dark-ground packshots (transparent PNG, dark JPG fallback) with SEO filenames.
 */
const PackshotGallery = () => {
  return (
    <div className="relative z-10 mt-12 grid grid-cols-2 gap-px bg-white/10 small:grid-cols-4">
      {PACKSHOTS.map((packshot) => (
        <LocalizedClientLink
          key={packshot.handle}
          href={`/products/${packshot.handle}`}
          className="group relative z-10 aspect-square overflow-hidden bg-ink-950"
        >
          <EditorialMedia
            src={packshot.png}
            fallback={packshot.jpg}
            alt={packshot.alt}
            objectFit="contain"
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="pointer-events-none p-6"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent px-4 pb-4 pt-12">
            <p className="editorial-hud text-neon">{packshot.label}</p>
            <p className="mt-2 text-sm text-white/70 transition group-hover:text-white">
              Ver producto
            </p>
          </div>
        </LocalizedClientLink>
      ))}
    </div>
  )
}

export default PackshotGallery
