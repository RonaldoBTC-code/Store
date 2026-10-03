import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261003140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payphone_claim" (
      "id" text not null,
      "client_transaction_id" text not null,
      "transaction_id" text null,
      "cart_id" text not null,
      "amount_cents" integer not null,
      "currency_code" text not null,
      "status" text not null,
      "order_id" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "payphone_claim_pkey" primary key ("id")
    );`)
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payphone_claim_client_transaction_id_unique" ON "payphone_claim" ("client_transaction_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payphone_claim_transaction_id_unique" ON "payphone_claim" ("transaction_id") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payphone_claim" cascade;`)
  }
}
