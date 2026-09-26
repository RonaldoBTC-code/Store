import { MedusaError } from "@medusajs/framework/utils"
import { assertSeedAllowed } from "../assert-seed-allowed"

describe("assertSeedAllowed", () => {
  it("refuses production when ALLOW_PROD_SEED is unset", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      MedusaError
    )
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /ALLOW_PROD_SEED=true/
    )
  })

  it("refuses production when the opt-in is any value other than true", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "1" })
    ).toThrow(MedusaError)
  })

  it("allows production when ALLOW_PROD_SEED=true", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "true" })
    ).not.toThrow()
  })

  it("allows non-production without the opt-in", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow()
    expect(() => assertSeedAllowed({})).not.toThrow()
  })
})
