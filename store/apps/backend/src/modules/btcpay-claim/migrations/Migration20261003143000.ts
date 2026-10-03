import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { btcpayMigrationDown, btcpayMigrationUp } from "./sql"

/**
 * BTCPay claim and payment tables in their final shape: integer cents,
 * hashed session id, one open invoice per cart, and one row per invoice id.
 */
export class Migration20261003143000 extends Migration {
  override async up(): Promise<void> {
    for (const sql of btcpayMigrationUp) {
      this.addSql(sql)
    }
  }

  override async down(): Promise<void> {
    for (const sql of btcpayMigrationDown) {
      this.addSql(sql)
    }
  }
}
