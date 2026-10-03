import type { MedusaContainer } from "@medusajs/framework/types"
import ensureEcuadorStore from "../scripts/ensure-ecuador-store"

/**
 * Fresh-database seed. Runs once from `medusa db:migrate`, including when
 * NODE_ENV=production. It only ensures the base Ecuador store (region, IVA,
 * shipping, publishable key, store, sales channel). It does not seed products.
 * Re-runs should use `pnpm seed:ec`, which calls the same idempotent setup.
 */
export default async function initialDataSeed({
  container,
}: {
  container: MedusaContainer
}) {
  await ensureEcuadorStore({ container })
}
