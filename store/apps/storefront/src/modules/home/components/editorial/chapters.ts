export const HOME_CHAPTERS = [
  { id: "hero", index: "01", label: "Drop" },
  { id: "collection", index: "02", label: "Colección" },
] as const

export type HomeChapterId = (typeof HOME_CHAPTERS)[number]["id"]
