import { getCartId } from "@lib/data/cookies"
import BtcpayReturn from "@modules/checkout/components/btcpay-return"

export default async function BtcpayReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const queryCartId = typeof params.cart_id === "string" ? params.cart_id : ""
  const cartId = queryCartId || (await getCartId()) || ""

  if (!cartId) {
    return (
      <div className="content-container py-16" data-testid="btcpay-return-status">
        <p data-testid="btcpay-payment-error">
          No encontramos el carrito de este pago.
        </p>
      </div>
    )
  }

  return <BtcpayReturn cartId={cartId} />
}
