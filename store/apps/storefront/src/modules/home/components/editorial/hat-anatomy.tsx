"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import CountUpStat from "./count-up-stat"
import EditorialMedia from "./editorial-media"

type Hotspot = {
  id: string
  top: string
  left: string
  title: string
  copy: string
  card: string
}

type Beat = {
  id: string
  kicker: string
  title: string
  copy: string
  stats: { value: number; suffix?: string; label: string }[]
}

const FALLBACK_IMAGE = "/editorial/hat-anatomy.png"

const HOTSPOTS: Hotspot[] = [
  {
    id: "patch",
    top: "38%",
    left: "52%",
    title: "Parche 3D",
    copy: "Bordado en relieve sobre negro. El pez no se escapa; el gato tampoco.",
    card: "top-8 left-1/2 -translate-x-1/2",
  },
  {
    id: "visor",
    top: "68%",
    left: "30%",
    title: "Visera curva",
    copy: "Perfil dad hat. Sombra baja, calle alta.",
    card: "bottom-full left-0 mb-3",
  },
  {
    id: "crown",
    top: "22%",
    left: "46%",
    title: "Corona unstructured",
    copy: "Caída suave, talla única unisex. Se adapta, no aprieta.",
    card: "top-8 left-1/2 -translate-x-1/2",
  },
]

const BEATS: Beat[] = [
  {
    id: "patch",
    kicker: "01 / Construcción",
    title: "El parche manda",
    copy: "Cinco mil puntadas de relieve. El motivo no es un print: es un objeto sobre la tela.",
    stats: [
      { value: 5, suffix: "k", label: "Puntadas de parche" },
      { value: 3, suffix: "D", label: "Relieve bordado" },
    ],
  },
  {
    id: "visor",
    kicker: "02 / Perfil",
    title: "Visera que no pide permiso",
    copy: "Curva clásica, no plana. El gesto de bajarla un milímetro cambia toda la silueta.",
    stats: [
      { value: 7, suffix: "cm", label: "Proyección de visera" },
      { value: 6, suffix: " paneles", label: "Corona dad hat" },
    ],
  },
  {
    id: "crown",
    kicker: "03 / Fit",
    title: "Talla única, cero drama",
    copy: "Unstructured, lavado a mano, sin planchar el bordado. Street, suave y un poco pícara.",
    stats: [
      { value: 1, suffix: "", label: "Talla unisex" },
      { value: 30, suffix: "°C", label: "Lavado máximo" },
    ],
  },
]

/**
 * Scroll-pinned hat anatomy module with hotspots and metric beats.
 */
const HatAnatomy = () => {
  const prefersReducedMotion = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const [activeBeat, setActiveBeat] = useState(0)
  const [openHotspot, setOpenHotspot] = useState<string | null>(null)
  const src = FALLBACK_IMAGE

  const handleToggleHotspot = useCallback((id: string) => {
    setOpenHotspot((current) => (current === id ? null : id))
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenHotspot(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  useLayoutEffect(() => {
    if (prefersReducedMotion) {
      return
    }

    gsap.registerPlugin(ScrollTrigger)
    const section = sectionRef.current
    const copy = copyRef.current

    if (!section || !copy) {
      return
    }

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()

      mm.add("(min-width: 1024px)", () => {
        BEATS.forEach((_, index) => {
          const trigger = copy.querySelector(`[data-beat="${index}"]`)
          if (!trigger) {
            return
          }

          ScrollTrigger.create({
            trigger,
            start: "top center",
            end: "bottom center",
            onEnter: () => setActiveBeat(index),
            onEnterBack: () => setActiveBeat(index),
          })
        })
      })
    }, section)

    return () => ctx.revert()
  }, [prefersReducedMotion])

  return (
    <section
      id="anatomy"
      ref={sectionRef}
      className="relative border-t border-white/10 bg-ink-900"
    >
      <div className="small:grid small:grid-cols-2">
        <div className="editorial-sticky-stage relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-ink-950 small:sticky small:top-16 small:h-[calc(100vh-4rem)] small:min-h-0">
          <div className="relative aspect-square w-[min(88%,34rem)]">
            <EditorialMedia
              src={src}
              fallback={FALLBACK_IMAGE}
              alt="Anatomía de la dad hat Gato Gang"
              objectFit="contain"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
            {HOTSPOTS.map((hotspot) => {
              const isOpen = openHotspot === hotspot.id
              const isLinked = BEATS[activeBeat]?.id === hotspot.id
              return (
                <div
                  key={hotspot.id}
                  className="absolute z-10"
                  style={{ top: hotspot.top, left: hotspot.left }}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`hotspot-card-${hotspot.id}`}
                    aria-label={hotspot.title}
                    onClick={() => handleToggleHotspot(hotspot.id)}
                    className={`relative flex h-5 w-5 items-center justify-center rounded-full border ${
                      isLinked || isOpen
                        ? "border-neon bg-neon shadow-glow"
                        : "border-neon/80 bg-ink-950"
                    }`}
                  >
                    <span
                      className="absolute inset-0 rounded-full bg-neon/40 animate-pulse-ring motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    <span className="relative h-2 w-2 rounded-full bg-white" />
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        id={`hotspot-card-${hotspot.id}`}
                        role="dialog"
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.22 }}
                        className={`absolute z-20 w-56 rounded-md border border-neon/40 bg-ink-900/90 p-4 shadow-glow-sm backdrop-blur-xl ${hotspot.card}`}
                      >
                        <p className="editorial-hud text-neon">{hotspot.title}</p>
                        <p className="mt-2 text-sm leading-relaxed text-white/75">
                          {hotspot.copy}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
          <p className="editorial-hud absolute bottom-6 left-6 text-white/40">
            03 / Hotspots
          </p>
        </div>

        <div
          ref={copyRef}
          className="relative border-t border-white/10 small:border-l small:border-t-0"
        >
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 py-10 no-scrollbar small:hidden">
            {BEATS.map((beat) => (
              <article
                key={`mobile-${beat.id}`}
                className="min-w-[85%] snap-center rounded-lg border border-white/10 bg-glass p-6 backdrop-blur-md"
              >
                <p className="editorial-hud text-neon">{beat.kicker}</p>
                <h3 className="mt-4 font-display text-3xl font-extrabold leading-tight">
                  {beat.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-white/70">{beat.copy}</p>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  {beat.stats.map((stat) => (
                    <CountUpStat
                      key={stat.label}
                      value={stat.value}
                      suffix={stat.suffix}
                      label={stat.label}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden small:block">
            {BEATS.map((beat, index) => (
              <article
                key={beat.id}
                data-beat={index}
                className="flex min-h-[100vh] flex-col justify-center px-10 py-24 medium:px-16"
              >
                <p className="editorial-hud text-neon">{beat.kicker}</p>
                <motion.h3
                  className="mt-6 max-w-md font-display text-5xl font-extrabold leading-[0.95]"
                  initial={false}
                  animate={{ opacity: activeBeat === index ? 1 : 0.35 }}
                  transition={{ duration: 0.35 }}
                >
                  {beat.title}
                </motion.h3>
                <p className="mt-6 max-w-md text-lg leading-relaxed text-white/70">
                  {beat.copy}
                </p>
                <div className="mt-10 max-w-sm">
                  {beat.stats.map((stat) => (
                    <CountUpStat
                      key={stat.label}
                      value={stat.value}
                      suffix={stat.suffix}
                      label={stat.label}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export default HatAnatomy
