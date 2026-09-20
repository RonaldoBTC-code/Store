export const HOME_CHAPTERS = [
  { id: "hero", index: "01", label: "Drop" },
  { id: "giro", index: "02", label: "Giro" },
  { id: "anatomy", index: "03", label: "Anatomía" },
  { id: "film", index: "04", label: "Loop" },
  { id: "collection", index: "05", label: "Colección" },
] as const

export type HomeChapterId = (typeof HOME_CHAPTERS)[number]["id"]
