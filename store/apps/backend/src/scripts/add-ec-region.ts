import type { ExecArgs } from "@medusajs/framework/types"
import ensureEcuadorStore from "./ensure-ecuador-store"

/**
 * Idempotent Ecuador setup. Safe to re-run after `medusa db:migrate`.
 */
export default async function addEcRegion({ container }: ExecArgs) {
  await ensureEcuadorStore({ container })
}
