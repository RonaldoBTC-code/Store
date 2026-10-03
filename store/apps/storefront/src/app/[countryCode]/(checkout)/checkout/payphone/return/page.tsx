import { sdk } from "@lib/config"
import { getAuthHeaders, getCartId, removeCartId } from "@lib/data/cookies"
import { PAYPHONE_PENDING_NOTICE } from "@lib/payphone-return"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { redirect } from "next/navigation"

type CompleteResponse = {
  order_id?: string
  country_code?: string
  state?: "no_charge" | "confirming" | "approved"
  code?: string
  charge?: string
}

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

  const cartId = await getCartId()
  let result: CompleteResponse

  try {
    result = await sdk.client.fetch<CompleteResponse>("/store/payphone/complete", {
      method: "POST",
      body: {
        id: Number(payphoneId),
        client_transaction_id: clientTransactionId,
        ...(cartId ? { cart_id: cartId } : {}),
      },
      headers: {
        ...(await getAuthHeaders()),
      },
      cache: "no-store",
    })
  } catch {
    return <PendingNotice />
  }

  if (result.order_id && /^order_[A-Za-z0-9]+$/.test(result.order_id)) {
    const orderCountry = safeCountry(result.country_code || country)
    await removeCartId()
    redirect(`/${orderCountry}/order/${result.order_id}/confirmed`)
  }

  if (result.state === "no_charge" || result.charge === "none" || result.charge === "reversal_confirmed") {
    redirect(`/${country}/checkout?step=payment&payphone=no_charge`)
  }

  return <PendingNotice />
}

function PendingNotice() {
  return (
    <div className="content-container py-16">
      <p className="text-xl" data-testid="payphone-pending">
        {PAYPHONE_PENDING_NOTICE}
      </p>
      <LocalizedClientLink
        href="/account/orders"
        className="mt-6 inline-block underline"
        data-testid="payphone-orders-link"
      >
        Tus pedidos
      </LocalizedClientLink>
    </div>
  )
}

function safeCountry(value: string | null | undefined) {
  const country = (value || "ec").toLowerCase()
  return /^[a-z]{2}$/.test(country) ? country : "ec"
}
