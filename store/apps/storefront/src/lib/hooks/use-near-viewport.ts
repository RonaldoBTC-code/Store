"use client"

import { RefObject, useEffect, useState } from "react"

/**
 * True when `ref` is within `rootMargin` of the viewport.
 * Used to defer decoding / playback of offscreen editorial media.
 */
export function useNearViewport<T extends Element>(
  ref: RefObject<T | null>,
  rootMargin = "280px",
  once = false
) {
  const [near, setNear] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }

    if (typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true)
          if (once) {
            observer.disconnect()
          }
        } else if (!once) {
          setNear(false)
        }
      },
      { rootMargin }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, rootMargin, once])

  return near
}
