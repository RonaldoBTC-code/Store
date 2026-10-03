import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * One row per BTCPay invoice. The unique index is what makes a webhook and
 * the shopper's return confirmation settle the same invoice once.
 */
export class Migration20261003143000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
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
      );`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_btcpay_invoice_claim_invoice_id_unique" ON "btcpay_invoice_claim" ("invoice_id") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_btcpay_invoice_claim_invoice_id_unique";`
    )
    this.addSql(`drop table if exists "btcpay_invoice_claim" cascade;`)
  }
}
