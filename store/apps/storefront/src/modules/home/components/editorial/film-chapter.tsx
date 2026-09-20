"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import EditorialVideo from "./editorial-video"
import FrameCorners from "./frame-corners"

const TAKES = [
  {
    src: "/editorial/scroll/transparente.mp4",
    poster: "/editorial/scroll/03.png",
    kicker: "04 / Loop — Take 01",
    title: "Transparente",
    copy: "Corte de estudio. La gorra flota y da la vuelta.",
  },
  {
    src: "/editorial/scroll/transparente-2.mp4",
    poster: "/editorial/scroll/02.png",
    kicker: "04 / Loop — Take 02",
    title: "Studio",
    copy: "Segunda toma. Misma silueta, otra luz.",
  },
] as const

/**
 * Studio loop chapter: both Scroll videos as sequential takes.
 */
const FilmChapter = () => {
  const prefersReducedMotion = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const take = TAKES[active] ?? TAKES[0]

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
            TAKES.length - 1,
            Math.floor(self.progress * TAKES.length)
          )
          setActive((current) => (current === next ? current : next))
        },
      })
    }, section)

    return () => ctx.revert()
  }, [prefersReducedMotion])

  return (
    <section
      id="film"
      ref={sectionRef}
      className="relative border-t border-white/10 bg-ink-950"
      style={{
        height: prefersReducedMotion ? undefined : `${TAKES.length * 100}vh`,
      }}
    >
      <div
        className={
          prefersReducedMotion
            ? "relative flex min-h-[calc(100dvh-4rem)] flex-col justify-end overflow-hidden"
            : "editorial-sticky-stage sticky top-16 flex h-[calc(100dvh-4rem)] flex-col justify-end overflow-hidden"
        }
      >
        <FrameCorners />

        <div className="absolute left-6 top-6 z-10 small:left-10 small:top-8">
          <p className="editorial-hud text-neon">{take.kicker}</p>
        </div>
        <p className="editorial-hud absolute right-6 top-6 z-10 text-white/45 small:right-10 small:top-8">
          {String(active + 1).padStart(2, "0")} / 02
        </p>

        <div className="relative mx-auto flex w-full max-w-4xl flex-1 items-center px-6 py-16 small:px-10">
          <div className="relative aspect-video w-full overflow-hidden border border-white/15 bg-ink-900">
            {TAKES.map((item, index) =>
              prefersReducedMotion || index === active ? (
                <div
                  key={item.src}
                  className={
                    prefersReducedMotion
                      ? index === 0
                        ? "absolute inset-0"
                        : "hidden"
                      : "absolute inset-0"
                  }
                >
                  <EditorialVideo
                    src={item.src}
                    poster={item.poster}
                    className="object-cover"
                    label="Dad hat Gato Gang en loop de estudio"
                    active={index === active}
                  />
                </div>
              ) : null
            )}
            <div
              className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-6 px-6 pb-16 small:flex-row small:items-end small:justify-between small:px-10 small:pb-14">
          <div className="max-w-xl">
            <h2 className="font-display text-4xl font-extrabold leading-[0.92] tracking-tight small:text-6xl">
              {take.title}.
              <br />
              Una vuelta.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70 small:text-base">
              {take.copy} Street, suave, un poco pícara.
            </p>
          </div>
          <LocalizedClientLink
            href="/store"
            className="editorial-hud rounded-full border border-neon/60 bg-neon/10 px-6 py-3 text-neon shadow-glow-sm transition hover:bg-neon hover:text-ink-950 hover:shadow-glow"
          >
            Ir a la tienda
          </LocalizedClientLink>
        </div>
      </div>
    </section>
  )
}

export default FilmChapter
