import { Metadata } from "next"

import InteractiveLink from "@modules/common/components/interactive-link"

export const metadata: Metadata = {
  title: "404",
  description: "No encontramos ese carrito",
}

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
      <h1 className="text-2xl-semi text-ui-fg-base">Carrito no encontrado</h1>
      <p className="text-small-regular text-ui-fg-base">
        Ese carrito no existe. Borra las cookies e inténtalo de nuevo.
      </p>
      <InteractiveLink href="/">Ir al inicio</InteractiveLink>
    </div>
  )
}
