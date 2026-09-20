"use client"

import { useReducedMotion } from "framer-motion"
import Image from "next/image"

type EditorialVideoProps = {
  src: string
  poster?: string
  className?: string
  label?: string
}

/**
 * Muted looping editorial plate. Respects reduced motion by freezing on the poster.
 */
const EditorialVideo = ({
  src,
  poster,
  className,
  label = "Gato Gang dad hat",
}: EditorialVideoProps) => {
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) {
    if (!poster) {
      return null
    }

    return (
      <Image
        src={poster}
        alt={label}
        fill
        sizes="(min-width: 1024px) 56rem, 100vw"
        className={`object-cover ${className ?? ""}`}
      />
    )
  }

  return (
    <video
      className={`absolute inset-0 h-full w-full object-cover ${className ?? ""}`}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster={poster}
      aria-label={label}
    >
      <source src={src} type="video/mp4" />
    </video>
  )
}

export default EditorialVideo
