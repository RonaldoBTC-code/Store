import { notFound } from "next/navigation"
import { Suspense } from "react"

import InteractiveLink from "@modules/common/components/interactive-link"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import PaginatedProducts from "@modules/store/templates/paginated-products"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { HttpTypes } from "@medusajs/types"
import { COLLECTION_SEO, isCategorySeoHandle } from "@lib/seo/copy"

export default function CategoryTemplate({
  category,
  sortBy,
  page,
  countryCode,
}: {
  category: HttpTypes.StoreProductCategory
  sortBy?: SortOptions
  page?: string
  countryCode: string
}) {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  if (!category || !countryCode) notFound()

  const parents = [] as HttpTypes.StoreProductCategory[]

  const getParents = (category: HttpTypes.StoreProductCategory) => {
    if (category.parent_category) {
      parents.push(category.parent_category)
      getParents(category.parent_category)
    }
  }

  getParents(category)

  const seo = isCategorySeoHandle(category.handle) ? COLLECTION_SEO : null
  const heading = seo?.h1 ?? category.name
  const intro = seo?.intro || category.description

  return (
    <div
      className="editorial-commerce bg-ink-950 text-white"
      data-testid="category-container"
    >
      <div className="content-container py-10 small:py-16">
      <div className="mb-10 flex flex-col gap-6 small:flex-row small:items-end small:justify-between">
        <div>
          <div className="flex flex-row gap-4 text-2xl-semi">
            {parents &&
              parents.map((parent) => (
                <span key={parent.id} className="text-white/70">
                  <LocalizedClientLink
                    className="mr-4 hover:text-neon"
                    href={`/categories/${parent.handle}`}
                    data-testid="sort-by-link"
                  >
                    {parent.name}
                  </LocalizedClientLink>
                  /
                </span>
              ))}
            <h1
              className="font-display text-4xl font-extrabold tracking-tight text-white"
              data-testid="category-page-title"
            >
              {heading}
            </h1>
          </div>
          {intro && (
            <p className="mt-3 max-w-2xl text-base-regular text-white/80">
              {intro}
            </p>
          )}
        </div>
        <RefinementList sortBy={sort} data-testid="sort-by-container" />
      </div>
      {category.category_children && (
        <div className="mb-8 text-base-large">
          <ul className="grid grid-cols-1 gap-2">
            {category.category_children?.map((c) => (
              <li key={c.id}>
                <InteractiveLink href={`/categories/${c.handle}`}>
                  {c.name}
                </InteractiveLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Suspense
        fallback={
          <SkeletonProductGrid
            numberOfProducts={category.products?.length ?? 8}
          />
        }
      >
        <PaginatedProducts
          sortBy={sort}
          page={pageNumber}
          categoryId={category.id}
          countryCode={countryCode}
        />
      </Suspense>
      </div>
    </div>
  )
}
