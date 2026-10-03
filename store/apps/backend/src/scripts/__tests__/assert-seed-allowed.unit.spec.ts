import fs from "fs"
import path from "path"
import { MedusaError } from "@medusajs/framework/utils"
import { assertSeedAllowed, isProductionNodeEnv } from "../assert-seed-allowed"
import {
  ecuadorReplacementIsReady,
  isCountryLevelEcuadorZone,
  shouldDeleteMisplacedEcuadorZones,
} from "../ecuador-zone-cleanup"

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8")

const LOCAL_DATABASE_URL = "postgres://medusa:medusa@127.0.0.1:5432/store"

describe("assertSeedAllowed", () => {
  it("refuses production when ALLOW_PROD_SEED is unset", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        DATABASE_URL: LOCAL_DATABASE_URL,
      })
    ).toThrow(MedusaError)
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        DATABASE_URL: LOCAL_DATABASE_URL,
      })
    ).toThrow(/ALLOW_PROD_SEED=true/)
  })

  it("refuses production when the opt-in is any value other than true", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "production",
        ALLOW_PROD_SEED: "1",
        DATABASE_URL: LOCAL_DATABASE_URL,
      })
    ).toThrow(MedusaError)
  })

  it("allows production when ALLOW_PROD_SEED=true", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "true" })
    ).not.toThrow()
  })

  it("treats prod and any casing of production as production", () => {
    for (const nodeEnv of ["prod", "PROD", "Production", " production "]) {
      expect(isProductionNodeEnv(nodeEnv)).toBe(true)
      expect(() =>
        assertSeedAllowed({
          NODE_ENV: nodeEnv,
          DATABASE_URL: LOCAL_DATABASE_URL,
        })
      ).toThrow(/NODE_ENV=production/)
    }
  })

  it("uses the database host as the primary check", () => {
    const databaseUrl = "postgres://app:s3cret@db.example.com:5432/store"

    expect(() =>
      assertSeedAllowed({ NODE_ENV: "Production", DATABASE_URL: databaseUrl })
    ).toThrow(/database host is non-local/)

    try {
      assertSeedAllowed({ NODE_ENV: "Production", DATABASE_URL: databaseUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain("NODE_ENV")
      expect(message).not.toContain(databaseUrl)
      expect(message).not.toContain("s3cret")
    }
  })

  it("allows non-production without the opt-in when the host is local", () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "development",
        DATABASE_URL: LOCAL_DATABASE_URL,
      })
    ).not.toThrow()
  })

  it("allows localhost and loopback hosts", () => {
    const urls = [
      "postgres://medusa:medusa@localhost:5432/store",
      "postgres://medusa:medusa@127.0.0.1:5432/store",
      "postgres://medusa:medusa@[::1]:5432/store",
    ]

    for (const databaseUrl of urls) {
      expect(() =>
        assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
      ).not.toThrow()
    }
  })

  it("refuses a missing or empty DATABASE_URL", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).toThrow(
      /database host is non-local/
    )
    expect(() => assertSeedAllowed({})).toThrow(/database host is non-local/)
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "   " })
    ).toThrow(/database host is non-local/)
    expect(() =>
      assertSeedAllowed({ ALLOW_PROD_SEED: "true" })
    ).not.toThrow()
  })

  it("refuses the postgres hostname unless ALLOW_PROD_SEED=true", () => {
    const databaseUrl = "postgres://medusa:medusa@postgres:5432/store"

    expect(() =>
      assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
    ).toThrow(/database host is non-local/)

    try {
      assertSeedAllowed({ NODE_ENV: "development", DATABASE_URL: databaseUrl })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(databaseUrl)
    }

    expect(() =>
      assertSeedAllowed({
        NODE_ENV: "development",
        ALLOW_PROD_SEED: "true",
        DATABASE_URL: databaseUrl,
      })
    ).not.toThrow()
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

describe("isCountryLevelEcuadorZone", () => {
  it("matches a single country zone for ec", () => {
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [{ type: "country", country_code: "ec" }],
      })
    ).toBe(true)
  })

  it("does not match province, city, or postal zones that use ec", () => {
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [
          { type: "province", country_code: "ec", province_code: "P" },
        ],
      })
    ).toBe(false)
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [{ type: "city", country_code: "ec", city: "Quito" }],
      })
    ).toBe(false)
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [
          { type: "zip", country_code: "ec", postal_expression: { zip: "170150" } },
        ],
      })
    ).toBe(false)
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [{ country_code: "ec" }],
      })
    ).toBe(false)
  })

  it("does not match a zone that covers more than Ecuador", () => {
    expect(
      isCountryLevelEcuadorZone({
        geo_zones: [
          { type: "country", country_code: "ec" },
          { type: "country", country_code: "co" },
        ],
      })
    ).toBe(false)
  })
})

describe("ecuadorReplacementIsReady", () => {
  it("requires the country zone and a shipping option before deletion", () => {
    expect(
      ecuadorReplacementIsReady({
        hasCountryZone: true,
        shippingOptionIds: ["so_1"],
      })
    ).toBe(true)
    expect(
      ecuadorReplacementIsReady({
        hasCountryZone: true,
        shippingOptionIds: [],
      })
    ).toBe(false)
    expect(
      ecuadorReplacementIsReady({
        hasCountryZone: false,
        shippingOptionIds: ["so_1"],
      })
    ).toBe(false)
  })
})
