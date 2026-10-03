/**
 * SQL for the BTCPay tables. Migrations and the Postgres integration test
 * both run these statements, including each `down`.
 *
 * Open invoice rows use status `holding` (slot taken, invoice not created yet)
 * and `pending` (invoice created, not settled). Those are not BTCPay's
 * `New` / `Processing` invoice statuses.
 */

export const migration143000Up = [
  `create table if not exists "btcpay_invoice_claim" (
        "id" text not null,
        "invoice_id" text not null,
        "cart_id" text not null,
        "payment_session_id" text not null,
        "amount_cents" integer not null,
        "currency_code" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "btcpay_invoice_claim_pkey" primary key ("id")
      );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_invoice_claim_invoice_id_unique" ON "btcpay_invoice_claim" ("invoice_id") WHERE deleted_at IS NULL;`,
]

export const migration143000Down = [
  `drop index if exists "IDX_btcpay_invoice_claim_invoice_id_unique";`,
  `drop table if exists "btcpay_invoice_claim" cascade;`,
]

export const migration160000Up = [
  `create table if not exists "btcpay_payment" (
        "id" text not null,
        "provider" text not null,
        "status" text not null,
        "cart_id" text not null,
        "customer_id" text null,
        "payment_session_id" text not null,
        "invoice_id" text null,
        "ip_hash" text null,
        "unit_count" integer not null,
        "expires_at" timestamptz not null,
        "reservation_ids" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "btcpay_payment_pkey" primary key ("id")
      );`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_cart_id" ON "btcpay_payment" ("provider", "status", "cart_id") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_customer_id" ON "btcpay_payment" ("provider", "status", "customer_id") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_session_id" ON "btcpay_payment" ("provider", "status", "payment_session_id") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_ip_hash_created_at" ON "btcpay_payment" ("provider", "ip_hash", "created_at") WHERE deleted_at IS NULL;`,
]

export const migration160000Down = [
  `drop table if exists "btcpay_payment" cascade;`,
]

/**
 * Adds the constraints the earlier migrations did not have:
 * UNIQUE (provider, invoice_id) where the invoice id is set, and one open
 * row per cart. Session ids are renamed to the hash column. USD cents stay
 * integer. No float and no sats column: this integration does not persist a
 * bitcoin amount.
 */
export const migration170000Up = [
  `ALTER TABLE "btcpay_payment" RENAME COLUMN "payment_session_id" TO "payment_session_hash";`,
  `ALTER TABLE "btcpay_invoice_claim" RENAME COLUMN "payment_session_id" TO "payment_session_hash";`,
  `ALTER TABLE "btcpay_payment" ALTER COLUMN "payment_session_hash" DROP NOT NULL;`,
  `ALTER TABLE "btcpay_invoice_claim" ALTER COLUMN "payment_session_hash" DROP NOT NULL;`,
  `DROP INDEX IF EXISTS "IDX_btcpay_payment_provider_status_session_id";`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_session_hash" ON "btcpay_payment" ("provider", "status", "payment_session_hash") WHERE deleted_at IS NULL;`,
  `ALTER TABLE "btcpay_payment" ADD COLUMN IF NOT EXISTS "amount_cents" integer NOT NULL DEFAULT 0;`,
  `ALTER TABLE "btcpay_payment" ALTER COLUMN "amount_cents" DROP DEFAULT;`,
  `ALTER TABLE "btcpay_payment" ADD COLUMN IF NOT EXISTS "replaces_id" text null;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_invoice_id_unique" ON "btcpay_payment" ("provider", "invoice_id") WHERE invoice_id IS NOT NULL AND deleted_at IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_payment_open_cart_unique" ON "btcpay_payment" ("cart_id") WHERE status IN ('holding', 'pending') AND deleted_at IS NULL;`,
]

export const migration170000Down = [
  `DROP INDEX IF EXISTS "IDX_btcpay_payment_open_cart_unique";`,
  `DROP INDEX IF EXISTS "IDX_btcpay_payment_provider_invoice_id_unique";`,
  `ALTER TABLE "btcpay_payment" DROP COLUMN IF EXISTS "replaces_id";`,
  `ALTER TABLE "btcpay_payment" DROP COLUMN IF EXISTS "amount_cents";`,
  `DROP INDEX IF EXISTS "IDX_btcpay_payment_provider_status_session_hash";`,
  `UPDATE "btcpay_payment" SET "payment_session_hash" = '' WHERE "payment_session_hash" IS NULL;`,
  `ALTER TABLE "btcpay_payment" ALTER COLUMN "payment_session_hash" SET NOT NULL;`,
  `ALTER TABLE "btcpay_payment" RENAME COLUMN "payment_session_hash" TO "payment_session_id";`,
  `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_session_id" ON "btcpay_payment" ("provider", "status", "payment_session_id") WHERE deleted_at IS NULL;`,
  `UPDATE "btcpay_invoice_claim" SET "payment_session_hash" = '' WHERE "payment_session_hash" IS NULL;`,
  `ALTER TABLE "btcpay_invoice_claim" ALTER COLUMN "payment_session_hash" SET NOT NULL;`,
  `ALTER TABLE "btcpay_invoice_claim" RENAME COLUMN "payment_session_hash" TO "payment_session_id";`,
]
