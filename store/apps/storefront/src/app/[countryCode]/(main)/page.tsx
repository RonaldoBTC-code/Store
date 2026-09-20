import { Metadata } from "next"

import EditorialShell from "@modules/home/components/editorial/editorial-shell"
import EditorialHero from "@modules/home/components/editorial/hero"
import PackshotGallery from "@modules/home/components/editorial/packshot-gallery"
import TraitCaps from "@modules/home/components/editorial/trait-caps"
import { HOME_SEO, metadataFromCopy } from "@lib/seo/copy"

export const metadata: Metadata = metadataFromCopy(HOME_SEO)

export default async function Home() {
  return (
    <EditorialShell>
      <EditorialHero />
      <TraitCaps />
      <section id="collection" className="relative z-10 bg-ink-950 pb-24 pt-8">
        <div className="content-container pt-10">
          <p className="editorial-hud text-neon">El drop completo</p>
        </div>
        <PackshotGallery />
      </section>
    </EditorialShell>
  )
}
