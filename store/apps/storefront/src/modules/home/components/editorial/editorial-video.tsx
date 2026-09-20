"use client"

import { useEffect, useRef } from "react"
import { useReducedMotion } from "framer-motion"
import Image from "next/image"
import { useNearViewport } from "@lib/hooks/use-near-viewport"

type EditorialVideoProps = {
  src: string
  poster?: string
  className?: string
  label?: string
  active?: boolean
}

/**
 * Muted looping editorial plate. Defers decode until near the viewport,
 * pauses when offscreen, and freezes on the poster for reduced motion.
 */
const EditorialVideo = ({
  src,
  poster,
  className,
  label = "Gato Gang dad hat",
  active = true,
}: EditorialVideoProps) => {
  const prefersReducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const near = useNearViewport(containerRef, "320px")
  const shouldPlay = Boolean(active && near && !prefersReducedMotion)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    if (shouldPlay) {
      video.preload = "auto"
      const play = video.play()
      if (play) {
        play.catch(() => undefined)
      }
      return
    }

    video.pause()
  }, [shouldPlay])

  if (prefersReducedMotion) {
    if (!poster) {
      return null
    }

    return (
      <div ref={containerRef} className="absolute inset-0">
        <Image
          src={poster}
          alt={label}
          fill
          sizes="(min-width: 1024px) 56rem, 100vw"
          className={`object-cover ${className ?? ""}`}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {near && active ? (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${className ?? ""}`}
          muted
          loop
          playsInline
          preload="none"
          poster={poster}
          aria-label={label}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : poster ? (
        <Image
          src={poster}
          alt={label}
          fill
          sizes="(min-width: 1024px) 56rem, 100vw"
          className={`object-cover ${className ?? ""}`}
        />
      ) : null}
    </div>
  )
}

export default EditorialVideo
