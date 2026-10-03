import { getCartId } from "@lib/data/cookies"
import BtcpayReturn from "@modules/checkout/components/btcpay-return"

export default async function BtcpayReturnPage() {
  const cartId = (await getCartId()) || ""

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
