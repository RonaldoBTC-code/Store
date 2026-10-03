import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Pending BTCPay invoices. The composite indexes are what the limit checks use
 * to count open invoices for a cart or a customer.
 */
export class Migration20261003160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
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
      );`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_cart_id" ON "btcpay_payment" ("provider", "status", "cart_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_customer_id" ON "btcpay_payment" ("provider", "status", "customer_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_status_session_id" ON "btcpay_payment" ("provider", "status", "payment_session_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_btcpay_payment_provider_ip_hash_created_at" ON "btcpay_payment" ("provider", "ip_hash", "created_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "btcpay_payment" cascade;`)
  }
}
