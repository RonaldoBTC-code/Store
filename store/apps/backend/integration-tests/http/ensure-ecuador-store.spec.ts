import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
  process.env.DB_HOST = url.hostname
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

medusaIntegrationTestRunner({
  dbName: "ecuador_setup_lock",
  testSuite: ({ getContainer }) => {
    it("keeps one Default Sales Channel and one default shipping profile when setup runs twice in parallel", async () => {
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

      const defaultChannels = ((channels ?? []) as NamedRecord[]).filter(
        (channel) => channel.name === "Default Sales Channel"
      )
      const defaultProfiles = ((profiles ?? []) as TypedRecord[]).filter(
        (profile) => profile.type === "default"
      )

      expect(defaultChannels).toHaveLength(1)
      expect(defaultProfiles).toHaveLength(1)
    })
  },
})
