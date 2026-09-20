"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { HOME_CHAPTERS } from "@modules/home/components/editorial/chapters"

const isCountryHome = (pathname: string) => /^\/[a-z]{2}\/?$/.test(pathname)

/**
 * Numbered chapter markers for the editorial homepage.
 * Only the markers themselves capture clicks so the rail cannot cover VIEW ALL.
 */
const ChapterRail = () => {
  const pathname = usePathname()
  const [activeId, setActiveId] = useState(HOME_CHAPTERS[0].id)

  useEffect(() => {
    if (!isCountryHome(pathname)) {
      return
    }

    let frame = 0

    const handleScroll = () => {
      const marker = window.innerHeight * 0.38
      let current = HOME_CHAPTERS[0].id

      HOME_CHAPTERS.forEach((chapter) => {
        const node = document.getElementById(chapter.id)
        if (!node) {
          return
        }

        if (node.getBoundingClientRect().top <= marker) {
          current = chapter.id
        }
      })

      setActiveId(current)
    }

    const onScroll = () => {
      if (frame) {
        return
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0
        handleScroll()
      })
    }

    handleScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)

    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [pathname])

  if (!isCountryHome(pathname)) {
    return null
  }

  const handleJump = (id: string) => {
    const node = document.getElementById(id)
    node?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <nav
      aria-label="Capítulos de la página"
      className="pointer-events-none fixed z-40 right-3 bottom-24 small:bottom-auto small:top-1/2 small:-translate-y-1/2"
    >
      <ol className="pointer-events-none relative flex flex-col gap-2 rounded-full border border-white/10 bg-ink-950/80 px-2 py-3 backdrop-blur-xl small:gap-3 small:px-2 small:py-4">
        <span
          className="absolute left-1/2 top-4 bottom-4 hidden w-px -translate-x-1/2 bg-white/15 small:block"
          aria-hidden="true"
        />
        {HOME_CHAPTERS.map((chapter) => {
          const isActive = activeId === chapter.id
          return (
            <li key={chapter.id} className="relative z-10">
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                aria-label={`${chapter.index} ${chapter.label}`}
                onClick={() => handleJump(chapter.id)}
                className={`editorial-hud group pointer-events-auto relative flex items-center gap-1 rounded-full px-2 py-1 transition small:w-10 small:flex-col ${
                  isActive
                    ? "text-neon shadow-glow-sm"
                    : "text-white/45 hover:text-white"
                }`}
              >
                <span>{chapter.index}</span>
                <span
                  className={`hidden h-5 w-px small:block ${isActive ? "bg-neon" : "bg-transparent"}`}
                  aria-hidden="true"
                />
                <span className="pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 whitespace-nowrap text-white/70 small:group-hover:block">
                  {chapter.label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default ChapterRail
