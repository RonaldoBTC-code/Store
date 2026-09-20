"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import EditorialMedia from "./editorial-media"
import FrameCorners from "./frame-corners"

type SequenceFrame = {
  src: string
  kicker: string
  title: string
  copy: string
  alt: string
}

const FRAMES: SequenceFrame[] = [
  {
    src: "/editorial/scroll/01.png",
    kicker: "02 / Giro — 01",
    title: "Perfil",
    copy: "Visera curva. Sombra baja. El lado que se ve cuando cruzas la calle.",
    alt: "Dad hat Gato Gang de perfil",
  },
  {
    src: "/editorial/scroll/04.png",
    kicker: "02 / Giro — 02",
    title: "Corona",
    copy: "Seis paneles, caída unstructured. La gorra no pide permiso: se sienta.",
    alt: "Corona de la dad hat Gato Gang vista desde arriba",
  },
  {
    src: "/editorial/scroll/03-close.png",
    kicker: "02 / Giro — 03",
    title: "Relieve",
    copy: "El parche no es un print. Es un objeto sobre negro.",
    alt: "Parche bordado en relieve sobre dad hat negra",
  },
  {
    src: "/editorial/product/fish-hug.png",
    kicker: "02 / Giro — 04",
    title: "Fish Hug",
    copy: "El gato y el pez. El chiste interno de la crew.",
    alt: "Gorra Fish Hug Gato Gang",
  },
  {
    src: "/editorial/product/lo-fi-cat.png",
    kicker: "02 / Giro — 05",
    title: "Lo-Fi Cat",
    copy: "Soundtrack propio. Audífonos puestos, calle apagada.",
    alt: "Gorra Lo-Fi Cat Gato Gang",
  },
  {
    src: "/editorial/product/busy-dog.png",
    kicker: "02 / Giro — 06",
    title: "Busy Dog",
    copy: "Humor de squad, no disfraz. El perro también es de la casa.",
    alt: "Gorra Busy Dog Gato Gang",
  },
  {
    src: "/editorial/product/cat-online.png",
    kicker: "02 / Giro — 07",
    title: "Cat Online",
    copy: "En llamada, mic muteado. Companion visual de Lo-Fi Cat.",
    alt: "Gorra Cat Online Gato Gang",
  },
]

const FRAME_VH = 85

/**
 * Pinned chapter: media advances in sequence as the user scrolls.
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
              key={item.src}
              className="grid border-t border-white/10 small:grid-cols-2"
            >
              <div className="relative min-h-[70vh] bg-ink-950">
                <EditorialMedia
                  src={item.src}
                  fallback={item.src}
                  alt={item.alt}
                  objectFit="contain"
                  sizes="(min-width: 1024px) 50vw, 100vw"
                />
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
      <div className="sticky top-16 h-[calc(100dvh-4rem)] overflow-hidden">
        {FRAMES.map((item, index) => (
          <div
            key={item.src}
            className="absolute inset-0 transition-opacity duration-300"
            style={{ opacity: index === active ? 1 : 0 }}
            aria-hidden={index !== active}
          >
            <EditorialMedia
              src={item.src}
              fallback={item.src}
              alt={item.alt}
              objectFit="contain"
              sizes="100vw"
              priority={index < 2}
            />
          </div>
        ))}

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/40"
          aria-hidden="true"
        />

        <FrameCorners />

        <div className="absolute left-6 top-6 z-10 flex items-center gap-3 small:left-10 small:top-8">
          <p className="editorial-hud text-white/50">Gato Gang</p>
          <span className="h-px w-8 bg-white/25" aria-hidden="true" />
          <p className="editorial-hud text-neon">{frame.kicker}</p>
        </div>

        <p className="editorial-hud absolute right-6 top-6 z-10 text-white/45 small:right-10 small:top-8">
          {String(active + 1).padStart(2, "0")} / {String(FRAMES.length).padStart(2, "0")}
        </p>

        <motion.div
          key={frame.title}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="absolute bottom-10 left-6 z-10 max-w-lg small:bottom-14 small:left-10"
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
