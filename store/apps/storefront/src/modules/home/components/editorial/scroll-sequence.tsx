"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import EditorialMedia from "./editorial-media"
import EditorialVideo from "./editorial-video"
import FrameCorners from "./frame-corners"
import { PACKSHOTS } from "./packshots"

type SequenceFrame = {
  kind: "image" | "video"
  src: string
  fallback?: string
  poster?: string
  kicker: string
  title: string
  copy: string
  alt: string
}

const FRAMES: SequenceFrame[] = [
  {
    kind: "image",
    src: "/editorial/scroll/01.png",
    kicker: "02 / Giro — 01",
    title: "Perfil",
    copy: "Visera curva. Sombra baja. El lado que se ve cuando cruzas la calle.",
    alt: "Fish Hug dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "image",
    src: "/editorial/scroll/02.png",
    kicker: "02 / Giro — 02",
    title: "Frente",
    copy: "El parche se lee de lejos. Mic muteado, mirada puesta.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "image",
    src: "/editorial/scroll/03.png",
    kicker: "02 / Giro — 03",
    title: "Tres cuartos",
    copy: "Misma silueta, otro ángulo. Street, suave, un poco pícara.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "video",
    src: "/editorial/scroll/transparente-2.mp4",
    poster: "/editorial/scroll/transparente-2-poster.jpg",
    kicker: "02 / Giro — 04",
    title: "Transición",
    copy: "La gorra da la vuelta. Diez segundos de corte.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "image",
    src: "/editorial/scroll/03-close.png",
    kicker: "02 / Giro — 05",
    title: "Relieve",
    copy: "El parche no es un print. Es un objeto sobre negro.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "image",
    src: "/editorial/scroll/04.png",
    kicker: "02 / Giro — 06",
    title: "Corona",
    copy: "Seis paneles, caída unstructured. La gorra no pide permiso: se sienta.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  {
    kind: "video",
    src: "/editorial/scroll/transparente-2.mp4",
    poster: "/editorial/scroll/transparente-2-poster.jpg",
    kicker: "02 / Giro — 07",
    title: "Studio",
    copy: "Otra toma. Misma silueta, otra luz.",
    alt: "Cat Online dad hat negra parche bordado Gato Gang",
  },
  ...PACKSHOTS.map((packshot, index) => ({
    kind: "image" as const,
    src: packshot.png,
    fallback: packshot.png,
    kicker: `02 / Giro — ${String(index + 8).padStart(2, "0")}`,
    title: packshot.label,
    copy: "Dad hat negra, parche bordado, talla única.",
    alt: packshot.alt,
  })),
]

const FRAME_VH = 80
const PRELOAD_RADIUS = 1

const SequenceStage = ({
  frame,
  active,
  priority,
}: {
  frame: SequenceFrame
  active: boolean
  priority?: boolean
}) => {
  if (frame.kind === "video") {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-6 small:px-16">
        <div className="relative aspect-video w-full max-w-4xl overflow-hidden border border-white/15 bg-ink-950">
          <EditorialVideo
            src={frame.src}
            poster={frame.poster}
            label={frame.alt}
            className="object-cover"
            active={active}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-ink-950">
      <EditorialMedia
        src={frame.src}
        fallback={frame.fallback || frame.src}
        alt={frame.alt}
        objectFit="contain"
        sizes="100vw"
        priority={priority}
      />
    </div>
  )
}

/**
 * Pinned chapter: stills and loop videos advance in sequence as the user scrolls.
 * Only the active frame plus one neighbor stay mounted to keep scroll light.
 */
const ScrollSequence = () => {
  const prefersReducedMotion = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const frame = FRAMES[active] ?? FRAMES[0]

  useLayoutEffect(() => {
    if (prefersReducedMotion) {
      return
    }

    gsap.registerPlugin(ScrollTrigger)
    const section = sectionRef.current

    if (!section) {
      return
    }

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top+=64",
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const next = Math.min(
            FRAMES.length - 1,
            Math.floor(self.progress * FRAMES.length)
          )
          setActive((current) => (current === next ? current : next))
        },
      })
    }, section)

    return () => ctx.revert()
  }, [prefersReducedMotion])

  if (prefersReducedMotion) {
    return (
      <section
        id="giro"
        className="relative border-t border-white/10 bg-ink-950"
      >
        <div className="content-container py-16">
          <p className="editorial-hud text-neon">02 / Giro</p>
          <h2 className="mt-4 max-w-2xl font-display text-4xl font-extrabold tracking-tight small:text-6xl">
            La gorra, cuadro a cuadro
          </h2>
        </div>
        <div className="flex flex-col">
          {FRAMES.map((item) => (
            <article
              key={`${item.kind}-${item.src}`}
              className="grid border-t border-white/10 small:grid-cols-2"
            >
              <div className="relative min-h-[70vh] overflow-hidden bg-ink-950">
                {item.kind === "video" ? (
                  <EditorialVideo
                    src={item.src}
                    poster={item.poster}
                    label={item.alt}
                    className="object-cover"
                  />
                ) : (
                  <EditorialMedia
                    src={item.src}
                    fallback={item.fallback || item.src}
                    alt={item.alt}
                    objectFit="contain"
                    sizes="(min-width: 1024px) 50vw, 100vw"
                  />
                )}
              </div>
              <div className="flex flex-col justify-center px-6 py-12 small:px-12">
                <p className="editorial-hud text-neon">{item.kicker}</p>
                <h3 className="mt-4 font-display text-3xl font-extrabold">
                  {item.title}
                </h3>
                <p className="mt-4 max-w-md text-white/70">{item.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section
      id="giro"
      ref={sectionRef}
      className="relative border-t border-white/10 bg-ink-950"
      style={{ height: `${FRAMES.length * FRAME_VH}vh` }}
    >
      <div className="editorial-sticky-stage sticky top-16 h-[calc(100dvh-4rem)] overflow-hidden">
        {FRAMES.map((item, index) => {
          const nearby = Math.abs(index - active) <= PRELOAD_RADIUS
          if (!nearby) {
            return null
          }

          return (
            <div
              key={`${item.kind}-${item.src}`}
              className="pointer-events-none absolute inset-0"
              style={{ opacity: index === active ? 1 : 0 }}
              aria-hidden={index !== active}
            >
              <SequenceStage
                frame={item}
                active={index === active}
                priority={index < 2}
              />
            </div>
          )
        })}

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/40"
          aria-hidden="true"
        />

        <FrameCorners />

        <div className="pointer-events-none absolute left-6 top-6 z-10 flex items-center gap-3 small:left-10 small:top-8">
          <p className="editorial-hud text-white/50">Gato Gang</p>
          <span className="h-px w-8 bg-white/25" aria-hidden="true" />
          <p className="editorial-hud text-neon">{frame.kicker}</p>
        </div>

        <p className="editorial-hud pointer-events-none absolute right-6 top-6 z-10 text-white/45 small:right-10 small:top-8">
          {String(active + 1).padStart(2, "0")} / {String(FRAMES.length).padStart(2, "0")}
        </p>

        <motion.div
          key={frame.title}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="pointer-events-none absolute bottom-10 left-6 z-10 max-w-lg small:bottom-14 small:left-10"
        >
          <h2 className="font-display text-4xl font-extrabold leading-[0.92] tracking-tight small:text-6xl">
            {frame.title}
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70 small:text-base">
            {frame.copy}
          </p>
        </motion.div>
      </div>
    </section>
  )
}

export default ScrollSequence
