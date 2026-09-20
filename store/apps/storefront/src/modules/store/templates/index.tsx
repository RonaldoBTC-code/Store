import { Suspense } from "react"

import { COLLECTION_SEO } from "@lib/seo/copy"
import { OptionValueIds } from "@lib/util/product-option-filters"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

import PaginatedProducts from "./paginated-products"

const StoreTemplate = ({
  sortBy,
  page,
  countryCode,
  optionValueIds,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  return (
    <div
      className="editorial-commerce bg-ink-950 text-white"
      data-testid="category-container"
    >
      <div className="content-container flex flex-col py-10 small:flex-row small:items-start small:py-16">
        <RefinementList sortBy={sort} />
        <div className="w-full">
          <div className="mb-8">
            <h1
              className="font-display text-4xl font-extrabold tracking-tight text-white small:text-6xl"
              data-testid="store-page-title"
            >
              {COLLECTION_SEO.h1}
            </h1>
            {COLLECTION_SEO.intro && (
              <p className="mt-3 max-w-2xl text-base-regular font-normal text-white/65">
                {COLLECTION_SEO.intro}
              </p>
            )}
          </div>
          <Suspense fallback={<SkeletonProductGrid />}>
            <PaginatedProducts
              sortBy={sort}
              page={pageNumber}
              countryCode={countryCode}
              optionValueIds={optionValueIds}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default StoreTemplate
