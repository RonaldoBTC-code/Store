import { Metadata } from "next"

import FeaturedProducts from "@modules/home/components/featured-products"
import EditorialShell from "@modules/home/components/editorial/editorial-shell"
import EditorialHero from "@modules/home/components/editorial/hero"
import FilmChapter from "@modules/home/components/editorial/film-chapter"
import HatAnatomy from "@modules/home/components/editorial/hat-anatomy"
import PackshotGallery from "@modules/home/components/editorial/packshot-gallery"
import ScrollSequence from "@modules/home/components/editorial/scroll-sequence"
import { listCollections } from "@lib/data/collections"
import { getRegion } from "@lib/data/regions"
import { HOME_SEO, metadataFromCopy } from "@lib/seo/copy"

export const metadata: Metadata = metadataFromCopy(HOME_SEO)

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const params = await props.params
  const { countryCode } = params

  let region = null
  let collections: Awaited<ReturnType<typeof listCollections>>["collections"] =
    []

  try {
    region = await getRegion(countryCode)
    if (region) {
      const listed = await listCollections({
        fields: "id, handle, title",
      })
      collections = listed.collections ?? []
    }
  } catch {
    region = null
    collections = []
  }

  return (
    <EditorialShell>
      <EditorialHero />
      <ScrollSequence />
      <HatAnatomy />
      <FilmChapter />
      <section
        id="collection"
        className="relative z-10 border-t border-white/10 bg-ink-950 py-8"
      >
        <div className="content-container pt-16">
          <p className="editorial-hud text-neon">05 / Colección</p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl font-extrabold tracking-tight text-white small:text-6xl">
            El drop completo
          </h2>
        </div>
        <PackshotGallery />
        {region && collections.length > 0 && (
          <ul className="flex flex-col">
            <FeaturedProducts
              collections={collections}
              region={region}
              tone="dark"
            />
          </ul>
        )}
      </section>
    </EditorialShell>
  )
}
