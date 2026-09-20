"use client"

import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion"

/**
 * Thin top-of-page scroll progress bar with a neon glow.
 */
const ScrollProgress = () => {
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    restDelta: 0.001,
  })

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[60] h-[2px] bg-white/10"
      aria-hidden="true"
    >
      <motion.div
        className="h-full origin-left bg-neon shadow-glow-sm"
        style={{ scaleX: prefersReducedMotion ? scrollYProgress : scaleX }}
      />
    </div>
  )
}

export default ScrollProgress
