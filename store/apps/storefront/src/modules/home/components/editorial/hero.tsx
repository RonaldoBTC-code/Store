"use client"

import { motion, useReducedMotion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialMedia from "./editorial-media"

const FALLBACK_IMAGE = "/editorial/hat-hero.png"

/**
 * Full-viewport editorial hero with typographic reveal and scroll cue.
 */
const EditorialHero = () => {
  const prefersReducedMotion = useReducedMotion()
  const delay = prefersReducedMotion ? 0 : 0.18

  const handleScrollToAnatomy = () => {
    document.getElementById("anatomy")?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    })
  }

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[calc(100dvh-4rem)] w-full items-end overflow-hidden bg-ink-950"
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 pt-8 small:justify-end small:px-16">
        <div className="relative h-[min(78vh,42rem)] w-full max-w-3xl">
          <EditorialMedia
            src={FALLBACK_IMAGE}
            fallback={FALLBACK_IMAGE}
            alt="Gato Gang dad hat"
            priority
            objectFit="contain"
            sizes="(min-width: 1024px) 55vw, 100vw"
          />
        </div>
      </div>
      <div
        className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/35 to-transparent"
        aria-hidden="true"
      />

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
            onClick={handleScrollToAnatomy}
            className="editorial-hud rounded-full border border-neon/60 bg-neon/10 px-6 py-3 text-neon shadow-glow-sm transition hover:bg-neon hover:text-ink-950 hover:shadow-glow"
          >
            02 Anatomía
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
        onClick={handleScrollToAnatomy}
        className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-white/70 transition hover:text-neon small:bottom-8"
        aria-label="Desplazar a anatomía de la gorra"
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
