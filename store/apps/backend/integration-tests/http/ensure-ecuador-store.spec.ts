import { createSalesChannelsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ECUADOR_SETUP_LOCK_KEY } from "../../src/scripts/ecuador-setup-lock"
import ensureEcuadorStore from "../../src/scripts/ensure-ecuador-store"

jest.setTimeout(300_000)

const useDatabaseCredentials = () => {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      "DATABASE_URL is required for the Ecuador setup integration test"
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      "DATABASE_URL could not be read for the Ecuador setup integration test"
    )
  }
  // @medusajs/test-utils 2.21 turns SSL off only when the database URL
  // contains the literal host "localhost". CI uses 127.0.0.1, and that
  // enables ssl against postgres:15 with TLS disabled, which fails with
  // "server does not support SSL". Map that host before test-utils reads
  // DB_HOST. The workflow that sets DATABASE_URL stays unchanged.
  const host = url.hostname.replace(/^\[|\]$/g, "")
  process.env.DB_HOST = host === "127.0.0.1" ? "localhost" : host
  process.env.DB_PORT = url.port || "5432"
  process.env.DB_USERNAME = decodeURIComponent(url.username)
  if (url.password) {
    process.env.DB_PASSWORD = decodeURIComponent(url.password)
  }
}

useDatabaseCredentials()

const { medusaIntegrationTestRunner } =
  require("@medusajs/test-utils") as typeof import("@medusajs/test-utils")

type NamedRecord = { name?: string | null }
type TypedRecord = { type?: string | null }
type RegionRecord = {
  countries?: { iso_2?: string | null }[] | null
}
type ServiceZoneRecord = { id?: string | null }
type FulfillmentSetRecord = {
  id?: string | null
  service_zones?: ServiceZoneRecord[] | null
}
type StockLocationRecord = {
  name?: string | null
  fulfillment_sets?: FulfillmentSetRecord[] | null
}
type TaxRateRecord = {
  name?: string | null
  code?: string | null
  rate?: number | null
}
type TaxRegionRecord = {
  country_code?: string | null
  tax_rates?: TaxRateRecord[] | null
}

medusaIntegrationTestRunner({
  dbName: "ecuador_setup_lock",
  testSuite: ({ getContainer }) => {
    it("keeps one of each Ecuador store row when setup runs twice in parallel", async () => {
      const container = getContainer()

      await Promise.all([
        ensureEcuadorStore({ container }),
        ensureEcuadorStore({ container }),
      ])

      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: channels } = await query.graph({
        entity: "sales_channel",
        fields: ["id", "name"],
      })
      const { data: profiles } = await query.graph({
        entity: "shipping_profile",
        fields: ["id", "type"],
      })
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id", "countries.iso_2"],
      })
      const { data: locations } = await query.graph({
        entity: "stock_location",
        fields: [
          "id",
          "name",
          "fulfillment_sets.id",
          "fulfillment_sets.service_zones.id",
        ],
      })
      const { data: shippingOptions } = await query.graph({
        entity: "shipping_option",
        fields: ["id", "name"],
      })
      const { data: taxRegions } = await query.graph({
        entity: "tax_region",
        fields: [
          "id",
          "country_code",
          "tax_rates.id",
          "tax_rates.name",
          "tax_rates.code",
          "tax_rates.rate",
        ],
      })

      const defaultChannels = ((channels ?? []) as NamedRecord[]).filter(
        (channel) => channel.name === "Default Sales Channel"
      )
      const defaultProfiles = ((profiles ?? []) as TypedRecord[]).filter(
        (profile) => profile.type === "default"
      )
      const ecuadorRegions = ((regions ?? []) as RegionRecord[]).filter(
        (region) =>
          (region.countries ?? []).some((country) => country.iso_2 === "ec")
      )
      const stockLocations = (locations ?? []) as StockLocationRecord[]
      const fulfillmentSets = stockLocations.flatMap(
        (location) => location.fulfillment_sets ?? []
      )
      const serviceZones = fulfillmentSets.flatMap(
        (set) => set.service_zones ?? []
      )
      const ivaRates = ((taxRegions ?? []) as TaxRegionRecord[])
        .filter((region) => region.country_code === "ec")
        .flatMap((region) => region.tax_rates ?? [])
        .filter(
          (rate) =>
            rate.name === "IVA" && rate.code === "IVA" && rate.rate === 15
        )

      expect(defaultChannels).toHaveLength(1)
      expect(defaultProfiles).toHaveLength(1)
      expect(ecuadorRegions).toHaveLength(1)
      expect(stockLocations).toHaveLength(1)
      expect(fulfillmentSets).toHaveLength(1)
      expect(serviceZones).toHaveLength(1)
      expect(shippingOptions ?? []).toHaveLength(1)
      expect(ivaRates).toHaveLength(1)
    }, 60_000)

    it("releases the advisory lock when setup throws so the next try can take it", async () => {
      const container = getContainer()
      await createSalesChannelsWorkflow(container).run({
        input: {
          salesChannelsData: [{ name: "Default Sales Channel" }],
        },
      })

      await expect(ensureEcuadorStore({ container })).rejects.toThrow(
        /Refusing to pick one/
      )

      const pgConnection = container.resolve(
        ContainerRegistrationKeys.PG_CONNECTION
      ) as {
        client: {
          acquireConnection: () => Promise<{
            query: (sql: string, params?: unknown[]) => Promise<{
              rows: { acquired?: boolean; unlocked?: boolean; pid?: number }[]
            }>
          }>
          releaseConnection: (connection: unknown) => Promise<unknown>
        }
      }
      const key = BigInt(ECUADOR_SETUP_LOCK_KEY)
      const classid = Number((key >> 32n) & 0xffffffffn)
      const objid = Number(key & 0xffffffffn)
      // Two checkouts at once are two sessions. The second one cannot be
      // the connection the pool would return first, so a reentrant
      // pg_try_advisory_lock on a still-held session cannot pass this test.
      const first = await pgConnection.client.acquireConnection()
      const second = await pgConnection.client.acquireConnection()
      try {
        const firstPid = await first.query("SELECT pg_backend_pid() AS pid")
        const secondPid = await second.query("SELECT pg_backend_pid() AS pid")
        expect(secondPid.rows[0]?.pid).not.toBe(firstPid.rows[0]?.pid)

        const held = await first.query(
          `SELECT pid
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = $1::oid
              AND objid = $2::oid
              AND objsubid = 1`,
          [String(classid), String(objid)]
        )
        expect(held.rows).toEqual([])

        const locked = await second.query(
          "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
          [String(ECUADOR_SETUP_LOCK_KEY)]
        )
        expect(locked.rows[0]?.acquired).toBe(true)
        const unlocked = await second.query(
          "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
          [String(ECUADOR_SETUP_LOCK_KEY)]
        )
        expect(unlocked.rows[0]?.unlocked).toBe(true)
      } finally {
        await pgConnection.client.releaseConnection(second)
        await pgConnection.client.releaseConnection(first)
      }
    }, 60_000)
  },
})
