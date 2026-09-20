"use client"

import Image from "next/image"
import { useState } from "react"

type EditorialMediaProps = {
  src?: string | null
  fallback: string
  alt: string
  className?: string
  sizes?: string
  priority?: boolean
  objectFit?: "cover" | "contain"
}

/**
 * Full-bleed editorial image that falls back to a local asset if the remote URL fails.
 */
const EditorialMedia = ({
  src,
  fallback,
  alt,
  className,
  sizes = "100vw",
  priority = false,
  objectFit = "cover",
}: EditorialMediaProps) => {
  const [currentSrc, setCurrentSrc] = useState(src || fallback)

  return (
    <Image
      src={currentSrc}
      alt={alt}
      fill
      priority={priority}
      loading={priority ? "eager" : "lazy"}
      sizes={sizes}
      className={`${objectFit === "contain" ? "object-contain object-center" : "object-cover object-center"} ${className ?? ""}`}
      onError={() => {
        if (currentSrc !== fallback) {
          setCurrentSrc(fallback)
        }
      }}
    />
  )
}

export default EditorialMedia
