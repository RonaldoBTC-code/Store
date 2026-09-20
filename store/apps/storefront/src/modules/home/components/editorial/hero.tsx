"use client"

import { motion, useReducedMotion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialVideo from "./editorial-video"
import FrameCorners from "./frame-corners"

const HERO_VIDEO = "/editorial/scroll/transparente-3-fondo-negro.mp4"
const HERO_POSTER = "/editorial/scroll/transparente-3-fondo-negro-poster.jpg"

/**
 * Full-viewport editorial hero with typographic reveal and scroll cue.
 */
const EditorialHero = () => {
  const prefersReducedMotion = useReducedMotion()
  const delay = prefersReducedMotion ? 0 : 0.18

  const handleScrollToGiro = () => {
    document.getElementById("giro")?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    })
  }

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[calc(100dvh-4rem)] w-full items-end overflow-hidden bg-ink-950"
    >
      <FrameCorners />

      <div className="pointer-events-none absolute inset-0">
        <EditorialVideo
          src={HERO_VIDEO}
          poster={HERO_POSTER}
          label="Gato Gang dad hat"
          className="object-cover"
          active
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-ink-950/20"
        aria-hidden="true"
      />

      <div className="absolute left-6 top-6 z-10 small:left-10 small:top-8">
        <p className="editorial-hud text-white/45">Gato Gang</p>
      </div>
      <p className="editorial-hud absolute right-6 top-6 z-10 text-white/45 small:right-10 small:top-8">
        01 / 05
      </p>

      <div className="relative z-10 flex w-full flex-col gap-8 px-6 pb-24 pt-28 small:px-12 small:pb-20">
        <motion.p
          className="editorial-hud text-neon"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay }}
        >
          Colección 01 / Dad hat
        </motion.p>

        <motion.h1
          className="max-w-5xl font-display text-5xl font-extrabold leading-[0.9] tracking-tight text-white small:text-7xl medium:text-8xl"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: delay + 0.12 }}
        >
          Street.
          <br />
          Suave.
          <br />
          <span className="text-white/80">Un poco pícara.</span>
        </motion.h1>

        <motion.p
          className="max-w-xl text-base leading-relaxed text-white/70 small:text-lg"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: delay + 0.24 }}
        >
          Dad hats negras con parche bordado en relieve. Energía de calle,
          visera curva y un universo ya resuelto.
        </motion.p>

        <motion.div
          className="flex flex-wrap items-center gap-4"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: delay + 0.34 }}
        >
          <button
            type="button"
            onClick={handleScrollToGiro}
            className="editorial-hud rounded-full border border-neon/60 bg-neon/10 px-6 py-3 text-neon shadow-glow-sm transition hover:bg-neon hover:text-ink-950 hover:shadow-glow"
          >
            02 Giro
          </button>
          <LocalizedClientLink
            href="/store"
            className="editorial-hud rounded-full border border-white/20 bg-glass px-6 py-3 text-white/80 backdrop-blur-md transition hover:border-white/50 hover:text-white"
          >
            Ir a la tienda
          </LocalizedClientLink>
        </motion.div>
      </div>

      <button
        type="button"
        onClick={handleScrollToGiro}
        className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-white/70 transition hover:text-neon small:bottom-8"
        aria-label="Desplazar al giro de la gorra"
      >
        <span className="editorial-hud">Scroll</span>
        <ChevronDown
          className={prefersReducedMotion ? "h-5 w-5" : "h-5 w-5 animate-float-y"}
          aria-hidden="true"
        />
      </button>
    </section>
  )
}

export default EditorialHero
