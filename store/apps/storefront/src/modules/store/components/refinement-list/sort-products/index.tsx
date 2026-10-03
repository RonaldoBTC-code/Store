"use client"

export type SortOptions = "price_asc" | "price_desc" | "created_at"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: string) => void
  "data-testid"?: string
}

const sortOptions = [
  {
    value: "created_at",
    label: "Lo más nuevo",
  },
  {
    value: "price_asc",
    label: "Precio: menor a mayor",
  },
  {
    value: "price_desc",
    label: "Precio: mayor a menor",
  },
]

const SortProducts = ({
  "data-testid": dataTestId,
  sortBy,
  setQueryParams,
}: SortProductsProps) => {
  return (
    <label className="editorial-hud flex items-center gap-3 text-white">
      <span className="text-neon">Ordenar</span>
      <select
        value={sortBy}
        onChange={(event) =>
          setQueryParams("sortBy", event.target.value as SortOptions)
        }
        className="focus-neon rounded-full border border-white/40 bg-ink-950 px-4 py-2 text-[11px] uppercase tracking-hud text-white focus:border-neon"
        aria-label="Ordenar productos"
        data-testid={dataTestId}
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default SortProducts
