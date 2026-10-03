import { completePayphoneReturn } from "@lib/data/payphone"
import { PayphoneReturnPoller } from "@modules/checkout/components/payphone-return/poller"
import { redirect } from "next/navigation"

export default async function PayphoneReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ id?: string; clientTransactionId?: string }>
}) {
  const { countryCode } = await params
  const query = await searchParams
  const country = safeCountry(countryCode)
  const payphoneId = query.id ?? ""
  const clientTransactionId = query.clientTransactionId ?? ""

  if (!/^\d{1,12}$/.test(payphoneId) || !/^[\w-]{1,50}$/.test(clientTransactionId)) {
    redirect(`/${country}/checkout?step=payment&payphone=no_charge`)
  }

  const result = await completePayphoneReturn({
    id: payphoneId,
    clientTransactionId,
  })

  if (result?.order_id && /^order_[A-Za-z0-9]+$/.test(result.order_id)) {
    const orderCountry = safeCountry(result.country_code || country)
    redirect(`/${orderCountry}/order/${result.order_id}/confirmed`)
  }

  if (result?.code === "document") {
    redirect(`/${country}/checkout?step=address&payphone=document`)
  }

  if (result?.code === "cart_changed") {
    redirect(`/${country}/checkout?step=payment&payphone=cart_changed`)
  }

  if (result?.charge === "reversal_confirmed") {
    return (
      <PayphoneReturnPoller
        country={country}
        payphoneId={payphoneId}
        clientTransactionId={clientTransactionId}
        initial={result}
      />
    )
  }

  if (result?.charge === "none" || result?.state === "no_charge") {
    redirect(`/${country}/checkout?step=payment&payphone=no_charge`)
  }

  return (
    <PayphoneReturnPoller
      country={country}
      payphoneId={payphoneId}
      clientTransactionId={clientTransactionId}
      initial={result}
    />
  )
}

function safeCountry(value: string | null | undefined) {
  const country = (value || "ec").toLowerCase()
  return /^[a-z]{2}$/.test(country) ? country : "ec"
}
