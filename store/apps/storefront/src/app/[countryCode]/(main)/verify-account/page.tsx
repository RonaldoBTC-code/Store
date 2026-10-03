import { Metadata } from "next"
import { Suspense } from "react"

import VerifyAccount from "@modules/account/components/verify-account"

export const metadata: Metadata = {
  title: "Confirma tu correo",
  description: "Confirma tu correo para terminar el registro.",
}

export default function VerifyAccountPage() {
  return (
    <div className="w-full flex justify-center px-8 py-12">
      <Suspense
        fallback={
          <p className="text-base-regular text-ui-fg-base">
            Estamos confirmando tu correo…
          </p>
        }
      >
        <VerifyAccount />
      </Suspense>
    </div>
  )
}
