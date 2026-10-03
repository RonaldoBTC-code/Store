import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { migration170000Down, migration170000Up } from "./sql"

/**
 * UNIQUE (provider, invoice_id) did not exist before this migration.
 * Null invoice ids stay allowed so a holding row can be inserted before
 * BTCPay returns an id. One open row per cart is the partial unique index
 * on cart_id for statuses holding and pending.
 */
export class Migration20261003170000 extends Migration {
  override async up(): Promise<void> {
    for (const sql of migration170000Up) {
      this.addSql(sql)
    }
  }

  override async down(): Promise<void> {
    for (const sql of migration170000Down) {
      this.addSql(sql)
    }
  }
}
