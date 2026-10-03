import { NextRequest, NextResponse } from "next/server"

/**
 * PayPhone redirects here with id and clientTransactionId. This route does
 * not confirm. It sends the shopper to the checkout page that shows
 * "Confirmando tu pago…" and then calls the same completion function as
 * the webhook. https://docs.payphone.app/boton-de-pago
 */
export async function GET(req: NextRequest) {
  const { origin, searchParams } = req.nextUrl
  const payphoneId = searchParams.get("id") ?? ""
  const clientTransactionId = searchParams.get("clientTransactionId") ?? ""
  const countryCode = safeCountry(searchParams.get("country_code"))

  if (!/^\d{1,12}$/.test(payphoneId) || !/^[\w-]{1,50}$/.test(clientTransactionId)) {
    return NextResponse.redirect(
      `${origin}/${countryCode}/checkout?step=payment&payphone=no_charge`
    )
  }

  const next = new URL(`/${countryCode}/checkout/payphone/return`, origin)
  next.searchParams.set("id", payphoneId)
  next.searchParams.set("clientTransactionId", clientTransactionId)
  return NextResponse.redirect(next)
}

function safeCountry(value: string | null | undefined) {
  const country = (value || "ec").toLowerCase()
  return /^[a-z]{2}$/.test(country) ? country : "ec"
}
