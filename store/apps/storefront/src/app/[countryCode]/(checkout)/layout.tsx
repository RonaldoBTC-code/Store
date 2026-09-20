import LocalizedClientLink from "@modules/common/components/localized-client-link"
import ChevronDown from "@modules/common/icons/chevron-down"

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="editorial-commerce relative w-full bg-ink-950 text-white small:min-h-screen">
      <div className="h-16 border-b border-white/10 bg-ink-950">
        <nav className="content-container flex h-full items-center justify-between font-hud text-[11px] uppercase tracking-hud text-white/70">
          <LocalizedClientLink
            href="/cart"
            className="flex flex-1 basis-0 items-center gap-x-2 text-white/70 transition hover:text-neon"
            data-testid="back-to-cart-link"
          >
            <ChevronDown className="rotate-90" size={16} />
            <span className="mt-px hidden small:block">Back to cart</span>
            <span className="mt-px block small:hidden">Back</span>
          </LocalizedClientLink>
          <LocalizedClientLink
            href="/"
            className="flex items-center gap-3 text-white transition hover:text-neon"
            data-testid="store-link"
          >
            <img
              src="/editorial/logo.png"
              alt="Gato Gang"
              className="h-10 w-10 object-contain"
            />
            <span className="text-sm tracking-hud">Gato Gang</span>
          </LocalizedClientLink>
          <div className="flex-1 basis-0" />
        </nav>
      </div>
      <div className="relative" data-testid="checkout-container">
        {children}
      </div>
    </div>
  )
}
