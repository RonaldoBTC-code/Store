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
    label: "Latest arrivals",
  },
  {
    value: "price_asc",
    label: "Price: low to high",
  },
  {
    value: "price_desc",
    label: "Price: high to low",
  },
]

const SortProducts = ({
  "data-testid": dataTestId,
  sortBy,
  setQueryParams,
}: SortProductsProps) => {
  return (
    <label className="editorial-hud flex items-center gap-3 text-white">
      <span className="text-neon">Sort</span>
      <select
        value={sortBy}
        onChange={(event) =>
          setQueryParams("sortBy", event.target.value as SortOptions)
        }
        className="rounded-full border border-white/40 bg-ink-950 px-4 py-2 text-[11px] uppercase tracking-hud text-white focus:border-neon focus:outline-none"
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
