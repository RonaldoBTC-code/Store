import { model } from "@medusajs/framework/utils"

/**
 * USD is integer cents (`model.number()` is PostgreSQL integer, not float).
 * This table does not store a bitcoin amount. A sats value would be bigint.
 * Open rows are `holding` and `pending`.
 */
const BtcpayPayment = model
  .define("btcpay_payment", {
    id: model.id().primaryKey(),
    provider: model.text(),
    status: model.text(),
    cart_id: model.text(),
    customer_id: model.text().nullable(),
    payment_session_hash: model.text().nullable(),
    invoice_id: model.text().nullable(),
    ip_hash: model.text().nullable(),
    unit_count: model.number(),
    amount_cents: model.number(),
    expires_at: model.dateTime(),
    reservation_ids: model.json().nullable(),
    replaces_id: model.text().nullable(),
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
    {
      on: ["provider", "invoice_id"],
      unique: true,
      where: "invoice_id IS NOT NULL AND deleted_at IS NULL",
      name: "IDX_btcpay_payment_provider_invoice_id_unique",
    },
    {
      on: ["cart_id"],
      unique: true,
      where: "status IN ('holding', 'pending') AND deleted_at IS NULL",
      name: "IDX_btcpay_payment_open_cart_unique",
    },
  ])

export default BtcpayPayment
