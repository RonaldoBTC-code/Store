/**
 * Stripe return URL. The cart id stays in the httpOnly cookie and is not
 * copied into this URL, where it would land in browser history and Stripe logs.
 */
export function paymentReturnUrl(origin: string, countryCode: string): string {
  const url = new URL("/api/payment-return", origin)

  if (countryCode) {
    url.searchParams.set("country_code", countryCode)
  }

  return url.toString()
}
