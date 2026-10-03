import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { migration143000Down, migration143000Up } from "./sql"

/**
 * One row per BTCPay invoice. The unique index is what makes a webhook and
 * the shopper's return confirmation settle the same invoice once.
 */
export class Migration20261003143000 extends Migration {
  override async up(): Promise<void> {
    for (const sql of migration143000Up) {
      this.addSql(sql)
    }
  }

  override async down(): Promise<void> {
    for (const sql of migration143000Down) {
      this.addSql(sql)
    }
  }
}
