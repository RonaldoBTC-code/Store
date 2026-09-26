import type { MedusaContainer } from "@medusajs/framework/types"
import ensureEcuadorStore from "../scripts/ensure-ecuador-store"

/**
 * Fresh-database seed. Runs once from `medusa db:migrate`.
 * Re-runs should use `pnpm seed:ec`, which calls the same idempotent setup.
 * No European region and no Medusa demo products.
 */
export default async function initialDataSeed({
  container,
}: {
  container: MedusaContainer
}) {
  await ensureEcuadorStore({ container })
}
