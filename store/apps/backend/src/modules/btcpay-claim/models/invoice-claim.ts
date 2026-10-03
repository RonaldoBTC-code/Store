import { model } from "@medusajs/framework/utils"

const BtcpayInvoiceClaim = model.define("btcpay_invoice_claim", {
  id: model.id().primaryKey(),
  invoice_id: model.text().unique(),
  cart_id: model.text(),
  payment_session_hash: model.text().nullable(),
  amount_cents: model.number(),
  currency_code: model.text(),
})

export default BtcpayInvoiceClaim
