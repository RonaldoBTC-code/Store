"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialVideo from "./editorial-video"
import FrameCorners from "./frame-corners"

/**
 * Studio loop chapter: the spinning hat as a framed editorial plate.
 */
const FilmChapter = () => {
  return (
    <section
      id="film"
      className="relative flex min-h-[calc(100dvh-4rem)] flex-col justify-end overflow-hidden border-t border-white/10 bg-ink-950"
    >
      <FrameCorners />

      <div className="absolute left-6 top-6 z-10 small:left-10 small:top-8">
        <p className="editorial-hud text-neon">04 / Loop</p>
      </div>
      <p className="editorial-hud absolute right-6 top-6 z-10 text-white/45 small:right-10 small:top-8">
        00:10
      </p>

      <div className="relative mx-auto flex w-full max-w-4xl flex-1 items-center px-6 py-16 small:px-10">
        <div className="relative aspect-video w-full overflow-hidden border border-white/15 bg-ink-900">
          <EditorialVideo
            src="/editorial/scroll/loop-2.mp4"
            poster="/editorial/scroll/03.png"
            className="object-cover"
            label="Dad hat Gato Gang en loop de estudio"
          />
          <div
            className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10"
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-6 px-6 pb-16 small:flex-row small:items-end small:justify-between small:px-10 small:pb-14">
        <div className="max-w-xl">
          <h2 className="font-display text-4xl font-extrabold leading-[0.92] tracking-tight small:text-6xl">
            Diez segundos.
            <br />
            Una vuelta.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70 small:text-base">
            La silueta no cambia. El parche sí se lee de lejos. Street, suave,
            un poco pícara.
          </p>
        </div>
        <LocalizedClientLink
          href="/store"
          className="editorial-hud rounded-full border border-neon/60 bg-neon/10 px-6 py-3 text-neon shadow-glow-sm transition hover:bg-neon hover:text-ink-950 hover:shadow-glow"
        >
          Ir a la tienda
        </LocalizedClientLink>
      </div>
    </section>
  )
}

export default FilmChapter
