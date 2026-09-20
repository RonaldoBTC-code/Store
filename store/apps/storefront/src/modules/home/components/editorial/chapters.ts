export const HOME_CHAPTERS = [
  { id: "hero", index: "01", label: "Drop" },
  { id: "parche", index: "02", label: "Parche" },
  { id: "visor", index: "03", label: "Visor" },
  { id: "collection", index: "04", label: "Colección" },
] as const

export type HomeChapterId = (typeof HOME_CHAPTERS)[number]["id"]
