"use client"

import { animate, useInView, useReducedMotion } from "framer-motion"
import { useEffect, useRef, useState } from "react"

type CountUpStatProps = {
  value: number
  suffix?: string
  label: string
}

/**
 * Animates a metric from zero when it enters the viewport.
 */
const CountUpStat = ({ value, suffix = "", label }: CountUpStatProps) => {
  const prefersReducedMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, amount: 0.55 })
  const [display, setDisplay] = useState(prefersReducedMotion ? value : 0)

  useEffect(() => {
    if (!isInView) {
      return
    }

    if (prefersReducedMotion) {
      setDisplay(value)
      return
    }

    const controls = animate(0, value, {
      duration: 1.15,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    })

    return () => controls.stop()
  }, [isInView, prefersReducedMotion, value])

  return (
    <div ref={ref} className="border-t border-white/10 py-5">
      <p className="font-display text-4xl font-extrabold tracking-tight text-white small:text-5xl">
        {display}
        {suffix}
      </p>
      <p className="editorial-hud mt-2 text-white/45">{label}</p>
    </div>
  )
}

export default CountUpStat
