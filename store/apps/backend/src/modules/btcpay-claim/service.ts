import { MedusaService } from "@medusajs/framework/utils"
import { claimOnce, type BtcpayClaimStore, type ClaimInput } from "../btcpay/claim"
import { registerBtcpayClaimStore } from "../btcpay/claim-registry"
import BtcpayInvoiceClaim from "./models/invoice-claim"

class BtcpayClaimModuleService
  extends MedusaService({ BtcpayInvoiceClaim })
  implements BtcpayClaimStore
{
  constructor(container: Record<string, unknown>) {
    // MedusaService's generated constructor is not part of the public types.
    super(container as never)
    registerBtcpayClaimStore(this)
  }

  async claim(input: ClaimInput) {
    return claimOnce(async () => {
      await this.createBtcpayInvoiceClaims({
        invoice_id: input.invoiceId,
        cart_id: input.cartId,
        payment_session_id: input.paymentSessionId,
        amount_cents: input.amountCents,
        currency_code: input.currencyCode,
      })
    })
  }
}

export default BtcpayClaimModuleService
