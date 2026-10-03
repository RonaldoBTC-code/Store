import { model } from "@medusajs/framework/utils"

const BtcpayPayment = model
  .define("btcpay_payment", {
    id: model.id().primaryKey(),
    provider: model.text(),
    status: model.text(),
    cart_id: model.text(),
    customer_id: model.text().nullable(),
    payment_session_id: model.text(),
    invoice_id: model.text().nullable(),
    ip_hash: model.text().nullable(),
    unit_count: model.number(),
    expires_at: model.dateTime(),
    reservation_ids: model.json().nullable(),
  })
  .indexes([
    {
      on: ["provider", "status", "cart_id"],
      name: "IDX_btcpay_payment_provider_status_cart_id",
    },
    {
      on: ["provider", "status", "customer_id"],
      name: "IDX_btcpay_payment_provider_status_customer_id",
    },
  ])

export default BtcpayPayment
