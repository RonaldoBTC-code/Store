import { Metadata } from "next"

/**
 * Storefront SEO copy sourced from seo/keyword-map-and-copy.md.
 * Static map only — not a CMS. Do not invent volumes or SKUs.
 */

export type SeoCopy = {
  title: string
  description: string
  h1: string
  intro?: string
}

export const HOME_SEO: SeoCopy = {
  title: "Gato Gang | Dad hats negras con parche bordado",
  description:
    "Gorras dad hat streetwear con parche 3D. Fish Hug, Lo-Fi Cat, Busy Dog y mas. Energia de calle, un poco picara.",
  h1: "Street. Suave. Un poco picara.",
}

export const COLLECTION_SEO: SeoCopy = {
  title: "Gorras dad hat | Coleccion Gato Gang",
  description:
    "Dad hats negras unisex con parche bordado en relieve. Drop 01: gatos, humor y streetwear suave.",
  h1: "Gorras Gato Gang",
  intro:
    "Dad hats negras, visera curva, parche bordado que se lee de lejos. Misma silueta, cuatro historias. Elige la que hable por ti sin gritar.",
}

export const COLLECTION_SEO_HANDLE = "gato-gang"
export const CATEGORY_SEO_HANDLE = "gorras"

export const PRODUCT_SEO: Record<string, SeoCopy> = {
  "fish-hug": {
    title: "Gorra Fish Hug | Dad hat gato con pez — Gato Gang",
    description:
      "Dad hat negra con parche bordado del gato que abraza el pez. Street, suave y un poco picara. Talla unica unisex.",
    h1: "Fish Hug",
  },
  "lo-fi-cat": {
    title: "Gorra Lo-Fi Cat | Dad hat gato con audifonos — Gato Gang",
    description:
      "Gorra negra con parche del gato lo-fi. Soundtrack propio, streetwear suave. Talla unica unisex.",
    h1: "Lo-Fi Cat",
  },
  "busy-dog": {
    title: "Gorra Busy Dog | Dad hat perro humor — Gato Gang",
    description:
      "Dad hat negra con parche del perro ocupado. Humor de squad, no disfraz. Regalo facil. Talla unica unisex.",
    h1: "Busy Dog",
  },
  "cat-online": {
    title: "Gorra Cat Online | Dad hat gato gamer — Gato Gang",
    description:
      "Parche del gato en llamada, mic muteado. Companion visual de Lo-Fi Cat. Dad hat negra, talla unica.",
    h1: "Cat Online",
  },
}

export function isCollectionSeoHandle(handle?: string | null) {
  return handle === COLLECTION_SEO_HANDLE
}

export function isCategorySeoHandle(handles?: string[] | string | null) {
  if (!handles) {
    return false
  }

  const last =
    typeof handles === "string"
      ? handles.split("/").filter(Boolean).pop()
      : handles[handles.length - 1]

  return last === CATEGORY_SEO_HANDLE
}

export function getProductSeo(
  handle?: string | null,
  fallbackTitle?: string
): SeoCopy {
  if (handle && PRODUCT_SEO[handle]) {
    return PRODUCT_SEO[handle]
  }

  const title = fallbackTitle || "Gato Gang"
  return {
    title: `${title} | Gato Gang`,
    description: title,
    h1: title,
  }
}

export function metadataFromCopy(
  copy: Pick<SeoCopy, "title" | "description">
): Metadata {
  return {
    title: copy.title,
    description: copy.description,
    openGraph: {
      title: copy.title,
      description: copy.description,
    },
  }
}
