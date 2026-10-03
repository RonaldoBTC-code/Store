import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * One PayPhone charge (their transactionId) can belong to only one claim.
 * Postgres allows many NULL transaction ids, so pending rows still insert.
 */
export class Migration20261003180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "payphone_claim" add constraint "payphone_claim_transaction_id_key" unique ("transaction_id");`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "payphone_claim" drop constraint if exists "payphone_claim_transaction_id_key";`
    )
  }
}
