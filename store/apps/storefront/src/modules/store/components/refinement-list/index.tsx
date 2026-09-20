"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import SortProducts, { SortOptions } from "./sort-products"

type RefinementListProps = {
  sortBy: SortOptions
  search?: boolean
  "data-testid"?: string
}

const RefinementList = ({
  sortBy,
  "data-testid": dataTestId,
}: RefinementListProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setQueryParams = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set(name, value)
      params.delete("page")
      params.delete("optionValueIds")

      const queryString = params.toString()
      const nextPath = queryString ? `${pathname}?${queryString}` : pathname
      const currentPath = searchParams.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname

      if (nextPath !== currentPath) {
        router.push(nextPath)
      }
    },
    [pathname, router, searchParams]
  )

  return (
    <SortProducts
      sortBy={sortBy}
      setQueryParams={setQueryParams}
      data-testid={dataTestId}
    />
  )
}

export default RefinementList
