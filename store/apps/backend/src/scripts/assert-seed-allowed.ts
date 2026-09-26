import { MedusaError } from "@medusajs/framework/utils"

type SeedEnv = {
  NODE_ENV?: string
  ALLOW_PROD_SEED?: string
}

/**
 * Seed and setup scripts are for local dev and CI.
 * They refuse to run in production unless ALLOW_PROD_SEED=true.
 */
export function assertSeedAllowed(env: SeedEnv = process.env) {
  if (env.NODE_ENV === "production" && env.ALLOW_PROD_SEED !== "true") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to run a seed script while NODE_ENV=production. Set ALLOW_PROD_SEED=true to opt in."
    )
  }
}
