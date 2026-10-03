/**
 * Final BTCPay schema. One migration creates both tables. There is no rename
 * and `down` does not fill empty strings.
 *
 * Open invoice rows use status `holding` (slot taken, invoice not created yet)
 * and `pending` (invoice created, not settled). Those are not BTCPay's
 * `New` / `Processing` invoice statuses.
 *
 * USD amounts are integer cents. There is no float column and no sats column.
 */

export const btcpayMigrationUp = [
  `create table if not exists "btcpay_invoice_claim" (
        "id" text not null,
        "invoice_id" text not null,
        "cart_id" text not null,
        "payment_session_hash" text null,
        "amount_cents" integer not null,
        "currency_code" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "btcpay_invoice_claim_pkey" primary key ("id")
      );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_invoice_claim_invoice_id_unique" ON "btcpay_invoice_claim" ("invoice_id") WHERE deleted_at IS NULL;`,
  `create table if not exists "btcpay_payment" (
        "id" text not null,
        "provider" text not null,
        "status" text not null,
        "cart_id" text not null,
        "customer_id" text null,
        "payment_session_hash" text null,
        "invoice_id" text null,
        "ip_hash" text null,
        "unit_count" integer not null,
        "amount_cents" integer not null,
        "expires_at" timestamptz not null,
        "reservation_ids" jsonb null,
        "replaces_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "btcpay_payment_pkey" primary key ("id")
      );`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_cart_id" ON "btcpay_payment" ("provider", "status", "cart_id") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_customer_id" ON "btcpay_payment" ("provider", "status", "customer_id") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_session_hash" ON "btcpay_payment" ("provider", "status", "payment_session_hash") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_ip_hash_created_at" ON "btcpay_payment" ("provider", "ip_hash", "created_at") WHERE deleted_at IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_invoice_id_unique" ON "btcpay_payment" ("provider", "invoice_id") WHERE invoice_id IS NOT NULL AND deleted_at IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_payment_open_cart_unique" ON "btcpay_payment" ("cart_id") WHERE status IN ('holding', 'pending') AND deleted_at IS NULL;`,
]

export const btcpayMigrationDown = [
  `drop table if exists "btcpay_payment" cascade;`,
  `drop table if exists "btcpay_invoice_claim" cascade;`,
]
