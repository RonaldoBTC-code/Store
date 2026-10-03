import fs from "fs"
import path from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { assertSeedAllowed } from "../assert-seed-allowed"
import { shouldDeleteMisplacedEcuadorZones } from "../ecuador-zone-cleanup"

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8")

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

  it("allows localhost, loopback, and the CI postgres service host", () => {
    const urls = [
      "postgres://medusa:medusa@localhost:5432/store",
      "postgres://medusa:medusa@127.0.0.1:5432/store",
      "postgres://medusa:medusa@[::1]:5432/store",
      "postgres://medusa:medusa@postgres:5432/store",
    ]

    for (const databaseUrl of urls) {
      expect(() =>
        assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
      ).not.toThrow()
    }
  })

  it("refuses a non-local database host without printing the connection string", () => {
    const databaseUrl = "postgres://app:s3cret@db.example.com:5432/store"

    expect(() =>
      assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
    ).toThrow(/database host is non-local/)

    try {
      assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(databaseUrl)
      expect(message).not.toContain("db.example.com")
      expect(message).not.toContain("s3cret")
    }
  })

  it("allows a non-local database host when ALLOW_PROD_SEED=true", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        ALLOW_PROD_SEED: "true",
        DATABASE_URL: "postgres://app:s3cret@db.example.com:5432/store",
      })
    ).not.toThrow()
  })

  it("treats an unreadable database host as non-local without echoing it", () => {
    const databaseUrl = "not a url @@"

    expect(() => assertSeedAllowed({ DATABASE_URL: databaseUrl })).toThrow(
      /non-local/
    )

    try {
      assertSeedAllowed({ DATABASE_URL: databaseUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(databaseUrl)
    }
  })
})

describe("base store setup guard", () => {
  it("keeps migrate and Ecuador setup free of the product seed guard", () => {
    const sources = [
      readSource("../ensure-ecuador-store.ts"),
      readSource("../../migration-scripts/initial-data-seed.ts"),
      readSource("../add-ec-region.ts"),
    ]

    for (const source of sources) {
      expect(source).not.toContain("assertSeedAllowed")
    }
  })

  it("keeps the guard on cap seeding and catalog sync", () => {
    expect(readSource("../seed-cap-products.ts")).toContain("assertSeedAllowed()")
    expect(readSource("../sync-gato-gang-catalog.ts")).toContain(
      "assertSeedAllowed()"
    )
  })
})

describe("shouldDeleteMisplacedEcuadorZones", () => {
  it("dry-runs unless FIX_EC_ZONES=true", () => {
    expect(shouldDeleteMisplacedEcuadorZones({})).toBe(false)
    expect(shouldDeleteMisplacedEcuadorZones({ FIX_EC_ZONES: "false" })).toBe(
      false
    )
    expect(shouldDeleteMisplacedEcuadorZones({ FIX_EC_ZONES: "1" })).toBe(false)
    expect(shouldDeleteMisplacedEcuadorZones({ FIX_EC_ZONES: "true" })).toBe(
      true
    )
  })
})
