import { Suspense } from "react"

import { listRegions } from "@lib/data/regions"
import { StoreRegion } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import CartButton from "@modules/layout/components/cart-button"
import ChapterRail from "@modules/layout/components/chapter-rail"
import ScrollProgress from "@modules/layout/components/scroll-progress"
import SideMenu from "@modules/layout/components/side-menu"

/**
 * Floating glass navbar with scroll progress and home chapter markers.
 */
export default async function Nav() {
  const regions = await listRegions().then((items: StoreRegion[]) => items)

  return (
    <>
      <div className="sticky top-0 inset-x-0 z-50 group">
        <ScrollProgress />
        <header className="relative z-50 h-16 mx-auto border-b border-white/10 bg-ink-950/70 backdrop-blur-xl">
          <nav className="content-container flex h-full w-full items-center justify-between font-hud text-[11px] uppercase tracking-hud text-white/70">
            <div className="flex h-full flex-1 basis-0 items-center">
              <div className="h-full text-white/80 hover:text-neon">
                <SideMenu
                  regions={regions}
                  locales={null}
                  currentLocale={null}
                />
              </div>
            </div>

            <div className="flex h-full items-center">
              <LocalizedClientLink
                href="/"
                className="flex items-center gap-3 text-white transition hover:text-neon hover:shadow-glow-sm"
                data-testid="nav-store-link"
              >
                <img
                  src="/editorial/logo.png"
                  alt="Gato Gang"
                  className="h-8 w-8 rounded-full object-cover"
                />
                <span className="text-sm tracking-hud">Gato Gang</span>
              </LocalizedClientLink>
            </div>

            <div className="flex h-full flex-1 basis-0 items-center justify-end gap-x-6">
              <div className="hidden h-full items-center gap-x-6 small:flex">
                <LocalizedClientLink
                  className="transition hover:text-neon"
                  href="/account"
                  data-testid="nav-account-link"
                >
                  Account
                </LocalizedClientLink>
              </div>
              <Suspense
                fallback={
                  <LocalizedClientLink
                    className="flex gap-2 transition hover:text-neon"
                    href="/cart"
                    data-testid="nav-cart-link"
                  >
                    Cart (0)
                  </LocalizedClientLink>
                }
              >
                <CartButton />
              </Suspense>
            </div>
          </nav>
        </header>
      </div>
      <ChapterRail />
    </>
  )
}
