import { model } from "@medusajs/framework/utils"

const PayphoneClaim = model.define("payphone_claim", {
  id: model.id().primaryKey(),
  client_transaction_id: model.text().unique(),
  transaction_id: model.text().unique().nullable(),
  cart_id: model.text(),
  amount_cents: model.number(),
  currency_code: model.text(),
  status: model.text(),
  order_id: model.text().nullable(),
})

export default PayphoneClaim
