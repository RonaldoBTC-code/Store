import type { MedusaContainer } from "@medusajs/framework/types"
import ensureEcuadorStore from "../scripts/ensure-ecuador-store"

/**
 * Fresh-database seed. Medusa 2.21 runs this once from `medusa db:migrate`,
 * including when NODE_ENV=production, and records the filename in
 * `script_migrations`. `finished_at` is written only after this function
 * returns. Later migrates skip a finished row, so this does not run on
 * every deploy. It only ensures the base Ecuador store (region, IVA,
 * shipping, publishable key, store, sales channel). It does not seed products.
 * Re-runs use `pnpm seed:ec`, which calls the same idempotent setup and does
 * not write `finished_at`.
 *
 * If the preflight throws, `finished_at` stays unset and every later migrate
 * fails until the conflict is fixed and `pnpm migrate` is run again.
 */
export default async function initialDataSeed({
  container,
}: {
  container: MedusaContainer
}) {
  await ensureEcuadorStore({ container })
}
