"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

const CHAPTERS = [
  { id: "hero", index: "01", label: "Drop" },
  { id: "anatomy", index: "02", label: "Anatomía" },
  { id: "collection", index: "03", label: "Colección" },
] as const

const isCountryHome = (pathname: string) => /^\/[a-z]{2}\/?$/.test(pathname)

/**
 * Numbered chapter markers for the editorial homepage.
 */
const ChapterRail = () => {
  const pathname = usePathname()
  const [activeId, setActiveId] = useState("hero")

  useEffect(() => {
    if (!isCountryHome(pathname)) {
      return
    }

    const handleObserve = (entries: IntersectionObserverEntry[]) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

      if (visible?.target.id) {
        setActiveId(visible.target.id)
      }
    }

    const observer = new IntersectionObserver(handleObserve, {
      rootMargin: "0px 0px -45% 0px",
      threshold: [0.2, 0.45, 0.7],
    })

    CHAPTERS.forEach((chapter) => {
      const node = document.getElementById(chapter.id)
      if (node) {
        observer.observe(node)
      }
    })

    return () => observer.disconnect()
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
      <ol className="pointer-events-auto flex flex-col gap-3 rounded-full border border-white/10 bg-ink-950/80 px-2 py-3 backdrop-blur-xl small:gap-4 small:px-2 small:py-4">
        {CHAPTERS.map((chapter) => {
          const isActive = activeId === chapter.id
          return (
            <li key={chapter.id}>
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                aria-label={`${chapter.index} ${chapter.label}`}
                onClick={() => handleJump(chapter.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    handleJump(chapter.id)
                  }
                }}
                className={`editorial-hud flex items-center gap-1 rounded-full px-2 py-1 transition small:w-10 small:flex-col ${
                  isActive
                    ? "text-neon shadow-glow-sm"
                    : "text-white/45 hover:text-white"
                }`}
              >
                <span>{chapter.index}</span>
                <span
                  className={`hidden h-6 w-px small:block ${isActive ? "bg-neon" : "bg-white/20"}`}
                  aria-hidden="true"
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default ChapterRail
