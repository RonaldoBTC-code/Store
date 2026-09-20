"use client"

import { motion, useReducedMotion } from "framer-motion"
import EditorialMedia from "./editorial-media"

type TraitCap = {
  id: string
  index: string
  title: "Parche" | "Visor" | "Material"
  copy: string
  src: string
  alt: string
}

const TRAITS: TraitCap[] = [
  {
    id: "parche",
    index: "02",
    title: "Parche",
    copy: "Bordado en relieve, no print. El motivo se lee de lejos y aguanta uso diario.",
    src: "/editorial/scroll/03-close.png",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    id: "visor",
    index: "03",
    title: "Visor",
    copy: "Curva dad hat. Sombra baja, perfil de calle.",
    src: "/editorial/scroll/01.png",
    alt: "Fish Hug dad hat negra parche bordado Gato Gang",
  },
  {
    id: "material",
    index: "03",
    title: "Material",
    copy: "Corona unstructured, talla única unisex. Se adapta, no aprieta.",
    src: "/editorial/scroll/04.png",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
]

/**
 * Short trait beats between hero and drop. Copy is fixed SEO; titles are H2.
 * Images stay pointer-events-none so they cannot block packshot or nav clicks.
 */
const TraitCaps = () => {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div className="relative z-10 border-t border-white/10 bg-ink-950">
      {TRAITS.map((trait, index) => {
        const flip = index % 2 === 1

        return (
          <section
            key={trait.id}
            id={trait.id}
            aria-labelledby={`trait-${trait.id}`}
            className="relative overflow-hidden"
          >
            <div
              className={`content-container grid items-center gap-10 py-20 small:grid-cols-2 small:gap-16 small:py-28 ${
                flip ? "small:[&>*:first-child]:order-2" : ""
              }`}
            >
              <motion.div
                className="relative mx-auto aspect-square w-full max-w-lg"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              >
                <div className="pointer-events-none absolute inset-0">
                  <EditorialMedia
                    src={trait.src}
                    fallback={trait.src}
                    alt={trait.alt}
                    objectFit="contain"
                    sizes="(min-width: 1024px) 40vw, 90vw"
                  />
                </div>
              </motion.div>

              <motion.div
                className="relative z-10 max-w-xl"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5, delay: 0.08, ease: "easeOut" }}
              >
                <p className="editorial-hud text-neon">
                  {trait.index} / {trait.title}
                </p>
                <h2
                  id={`trait-${trait.id}`}
                  className="mt-5 font-display text-5xl font-extrabold leading-[0.9] tracking-tight text-white small:text-7xl"
                >
                  {trait.title}
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-white/80 small:text-lg">
                  {trait.copy}
                </p>
              </motion.div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default TraitCaps
