import { sdk } from "@lib/config"
import { getAuthHeaders, getCartId, removeCartId } from "@lib/data/cookies"
import { unstable_rethrow } from "next/navigation"
import { NextRequest, NextResponse } from "next/server"

const STATUS_CODES = new Set([
  "cancelled",
  "declined",
  "mismatch",
  "pending",
  "failed",
  "amount",
  "currency",
  "client",
  "cart_changed",
  "in_progress",
])

/**
 * PayPhone redirects here with id and clientTransactionId. Those values are
 * only a pointer: the backend confirms them with PayPhone before completing
 * the cart. https://docs.payphone.app/boton-de-pago
 */
export async function GET(req: NextRequest) {
  const { origin, searchParams } = req.nextUrl
  const payphoneId = searchParams.get("id") ?? ""
  const clientTransactionId = searchParams.get("clientTransactionId") ?? ""
  const countryCode = safeCountry(searchParams.get("country_code"))

  const failed = (status: string) =>
    NextResponse.redirect(
      `${origin}/${countryCode}/checkout?step=payment&payphone=${status}`
    )

  if (!/^\d{1,12}$/.test(payphoneId) || !/^[\w-]{1,50}$/.test(clientTransactionId)) {
    return failed("failed")
  }

  try {
    const cartId = await getCartId()
    const result = await sdk.client.fetch<{
      order_id?: string
      country_code?: string
      code?: string
    }>("/store/payphone/complete", {
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

    const orderId = result.order_id ?? ""
    const orderCountry = safeCountry(result.country_code)

    if (!/^order_[A-Za-z0-9]+$/.test(orderId)) {
      return failed(STATUS_CODES.has(result.code ?? "") ? result.code! : "failed")
    }

    await removeCartId()
    return NextResponse.redirect(
      `${origin}/${orderCountry}/order/${orderId}/confirmed`
    )
  } catch (error) {
    unstable_rethrow(error)

    const code = readErrorCode(error)
    return failed(code)
  }
}

function safeCountry(value: string | null | undefined) {
  const country = (value || "ec").toLowerCase()
  return /^[a-z]{2}$/.test(country) ? country : "ec"
}

function readErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "")
    if (STATUS_CODES.has(code)) {
      return code
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : ""

  if (message.toLowerCase().includes("ya se está procesando")) {
    return "in_progress"
  }

  if (message.toLowerCase().includes("no es usd")) {
    return "currency"
  }

  if (message.toLowerCase().includes("no corresponde")) {
    return "client"
  }

  if (message.toLowerCase().includes("cambió") || message.toLowerCase().includes("cambio")) {
    return "cart_changed"
  }

  if (message.toLowerCase().includes("cancel")) {
    return "cancelled"
  }

  if (message.toLowerCase().includes("rechaz")) {
    return "declined"
  }

  if (message.toLowerCase().includes("no coincide")) {
    return "mismatch"
  }

  return "failed"
}
