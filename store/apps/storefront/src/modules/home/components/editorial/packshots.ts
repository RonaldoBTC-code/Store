export type Packshot = {
  handle: "fish-hug" | "lo-fi-cat" | "busy-dog" | "cat-online"
  label: "Fish Hug" | "Lo-Fi Cat" | "Busy Dog" | "Cat Online"
  png: string
  alt: string
}

const altFor = (label: Packshot["label"]) =>
  `${label} dad hat negra parche bordado Gato Gang`

export const PACKSHOTS: Packshot[] = [
  {
    handle: "fish-hug",
    label: "Fish Hug",
    png: "/editorial/product/fish-hug-dad-hat-gato-gang.png",
    alt: altFor("Fish Hug"),
  },
  {
    handle: "lo-fi-cat",
    label: "Lo-Fi Cat",
    png: "/editorial/product/lo-fi-cat-dad-hat-gato-gang.png",
    alt: altFor("Lo-Fi Cat"),
  },
  {
    handle: "busy-dog",
    label: "Busy Dog",
    png: "/editorial/product/busy-dog-dad-hat-gato-gang.png",
    alt: altFor("Busy Dog"),
  },
  {
    handle: "cat-online",
    label: "Cat Online",
    png: "/editorial/product/cat-online-dad-hat-gato-gang.png",
    alt: altFor("Cat Online"),
  },
]

export function getPackshot(handle?: string | null) {
  if (!handle) {
    return undefined
  }

  return PACKSHOTS.find((packshot) => packshot.handle === handle)
}
