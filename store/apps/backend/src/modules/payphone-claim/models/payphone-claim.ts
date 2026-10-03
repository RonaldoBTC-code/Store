import { model } from "@medusajs/framework/utils"

const PayphoneClaim = model.define("payphone_claim", {
  id: model.id().primaryKey(),
  client_transaction_id: model.text().unique(),
  // The full UNIQUE constraint is added in Migration20261003180000.
  // `.unique()` would emit a third index next to that constraint.
  transaction_id: model.text().nullable(),
  cart_id: model.text(),
  amount_cents: model.number(),
  currency_code: model.text(),
  status: model.text(),
  order_id: model.text().nullable(),
})

export default PayphoneClaim
