import { Suspense } from "react"

import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import PaginatedProducts from "@modules/store/templates/paginated-products"
import { HttpTypes } from "@medusajs/types"
import { COLLECTION_SEO, isCollectionSeoHandle } from "@lib/seo/copy"
import { OptionValueIds } from "@lib/util/product-option-filters"

export default function CollectionTemplate({
  sortBy,
  collection,
  page,
  countryCode,
  optionValueIds,
}: {
  sortBy?: SortOptions
  collection: HttpTypes.StoreCollection
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
}) {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"
  const seo = isCollectionSeoHandle(collection.handle) ? COLLECTION_SEO : null

  return (
    <div className="editorial-commerce bg-ink-950 text-white">
      <div className="content-container flex flex-col py-10 small:flex-row small:items-start small:py-16">
      <RefinementList sortBy={sort} hideOptionsPicker />
      <div className="w-full">
        <div className="mb-8">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-white small:text-6xl">
            {seo?.h1 ?? collection.title}
          </h1>
          {seo?.intro && (
            <p className="mt-3 max-w-2xl text-base-regular font-normal text-white/65">
              {seo.intro}
            </p>
          )}
        </div>
        <Suspense
          fallback={
            <SkeletonProductGrid
              numberOfProducts={collection.products?.length}
            />
          }
        >
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            collectionId={collection.id}
            countryCode={countryCode}
            optionValueIds={optionValueIds}
          />
        </Suspense>
      </div>
      </div>
    </div>
  )
}
