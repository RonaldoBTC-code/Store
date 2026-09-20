import { Suspense } from "react"

import { COLLECTION_SEO } from "@lib/seo/copy"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

import PaginatedProducts from "./paginated-products"

const StoreTemplate = ({
  sortBy,
  page,
  countryCode,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  return (
    <div
      className="editorial-commerce bg-ink-950 text-white"
      data-testid="category-container"
    >
      <div className="content-container py-10 small:py-16">
        <div className="mb-10 flex flex-col gap-6 small:flex-row small:items-end small:justify-between">
          <div>
            <h1
              className="font-display text-4xl font-extrabold tracking-tight text-white small:text-6xl"
              data-testid="store-page-title"
            >
              {COLLECTION_SEO.h1}
            </h1>
            {COLLECTION_SEO.intro && (
              <p className="mt-3 max-w-2xl text-base-regular font-normal text-white/80">
                {COLLECTION_SEO.intro}
              </p>
            )}
          </div>
          <RefinementList sortBy={sort} />
        </div>
        <Suspense fallback={<SkeletonProductGrid />}>
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            countryCode={countryCode}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default StoreTemplate
