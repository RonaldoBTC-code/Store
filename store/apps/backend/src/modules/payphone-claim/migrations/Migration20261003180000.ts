import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * One PayPhone charge (their transactionId) can belong to only one claim.
 * Postgres allows many NULL transaction ids, so pending rows still insert.
 * The partial unique index from Migration20261003140000 is replaced by this
 * full UNIQUE so a soft-deleted row cannot keep the same charge id.
 */
export class Migration20261003180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "IDX_payphone_claim_transaction_id_unique";`
    )
    this.addSql(
      `alter table "payphone_claim" add constraint "payphone_claim_transaction_id_key" unique ("transaction_id");`
    )
    this.addSql(
      `alter table "payphone_claim" add constraint "payphone_claim_status_check" check ("status" in ('pending', 'processing', 'captured', 'rejected', 'needs_reversal', 'reversing', 'reversed'));`
    )
    this.addSql(
      `alter table "payphone_claim" add constraint "payphone_claim_amount_cents_check" check ("amount_cents" > 0);`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payphone_claim_cart_open_unique" ON "payphone_claim" ("cart_id") WHERE "deleted_at" IS NULL AND "status" IN ('pending', 'processing');`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_payphone_claim_status_job" ON "payphone_claim" ("updated_at") WHERE "deleted_at" IS NULL AND "status" IN ('processing', 'needs_reversal');`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_payphone_claim_status_job";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_payphone_claim_cart_open_unique";`)
    this.addSql(
      `alter table "payphone_claim" drop constraint if exists "payphone_claim_amount_cents_check";`
    )
    this.addSql(
      `alter table "payphone_claim" drop constraint if exists "payphone_claim_status_check";`
    )
    this.addSql(
      `alter table "payphone_claim" drop constraint if exists "payphone_claim_transaction_id_key";`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payphone_claim_transaction_id_unique" ON "payphone_claim" ("transaction_id") WHERE deleted_at IS NULL;`
    )
  }
}
