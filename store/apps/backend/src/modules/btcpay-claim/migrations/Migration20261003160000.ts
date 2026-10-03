import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { migration160000Down, migration160000Up } from "./sql"

/**
 * Pending BTCPay invoices. The composite indexes are what the limit checks use
 * to count open invoices for a cart or a customer.
 */
export class Migration20261003160000 extends Migration {
  override async up(): Promise<void> {
    for (const sql of migration160000Up) {
      this.addSql(sql)
    }
  }

  override async down(): Promise<void> {
    for (const sql of migration160000Down) {
      this.addSql(sql)
    }
  }
}
