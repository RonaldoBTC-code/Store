import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import * as coreFlows from "@medusajs/medusa/core-flows"
import { ECUADOR_SETUP_LOCK_KEY } from "../ecuador-setup-lock"
import ensureEcuadorStore from "../ensure-ecuador-store"

const LOCK_SQL = "SELECT pg_advisory_lock($1::bigint)"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint)"

jest.mock("pg", () => {
  const connect = jest.fn(async () => undefined)
  const query = jest.fn(async () => ({ rows: [] }))
  const end = jest.fn(async () => undefined)
  return {
    Client: jest.fn(() => ({
      connect,
      query,
      end,
      on: jest.fn(),
    })),
    __pg: { connect, query, end },
  }
})

const pgState = (
  require("pg") as {
    __pg: {
      connect: jest.Mock
      query: jest.Mock
      end: jest.Mock
    }
  }
).__pg

const WORKFLOW_NAMES = [
  "createApiKeysWorkflow",
  "createPricePreferencesWorkflow",
  "createRegionsWorkflow",
  "createSalesChannelsWorkflow",
  "createServiceZonesWorkflow",
  "createShippingOptionsWorkflow",
  "createShippingProfilesWorkflow",
  "createStockLocationsWorkflow",
  "createStoresWorkflow",
  "createTaxRatesWorkflow",
  "createTaxRegionsWorkflow",
  "deleteServiceZonesWorkflow",
  "deleteShippingOptionsWorkflow",
  "linkSalesChannelsToApiKeyWorkflow",
  "linkSalesChannelsToStockLocationWorkflow",
  "updatePricePreferencesWorkflow",
  "updateRegionsWorkflow",
  "updateShippingOptionsWorkflow",
  "updateStoresWorkflow",
] as const

jest.mock("@medusajs/medusa/core-flows", () => {
  const run = jest.fn(async () => ({ result: [{ id: "written" }] }))
  const workflow = jest.fn(() => ({ run }))
  const mocked: Record<string, unknown> = { __run: run, __workflow: workflow }
  for (const name of [
    "createApiKeysWorkflow",
    "createPricePreferencesWorkflow",
    "createRegionsWorkflow",
    "createSalesChannelsWorkflow",
    "createServiceZonesWorkflow",
    "createShippingOptionsWorkflow",
    "createShippingProfilesWorkflow",
    "createStockLocationsWorkflow",
    "createStoresWorkflow",
    "createTaxRatesWorkflow",
    "createTaxRegionsWorkflow",
    "deleteServiceZonesWorkflow",
    "deleteShippingOptionsWorkflow",
    "linkSalesChannelsToApiKeyWorkflow",
    "linkSalesChannelsToStockLocationWorkflow",
    "updatePricePreferencesWorkflow",
    "updateRegionsWorkflow",
    "updateShippingOptionsWorkflow",
    "updateStoresWorkflow",
  ]) {
    mocked[name] = workflow
  }
  return mocked
})

const flows = coreFlows as typeof coreFlows & {
  __run: jest.Mock
  __workflow: jest.Mock
}

const storeFor = (
  records: {
    channels?: { id: string; name?: string | null }[]
    profiles?: { id: string; name?: string | null; type?: string | null }[]
    regions?: {
      id: string
      name?: string | null
      currency_code?: string | null
      countries?: { iso_2?: string | null }[]
    }[]
  },
  databaseUrl = "postgres://lock@127.0.0.1:5432/ecuador_lock_test"
) => {
  const moduleWrites: string[] = []
  const link = {
    create: jest.fn(async () => {
      moduleWrites.push("link.create")
    }),
  }
  const fulfillment = {
    createFulfillmentSets: jest.fn(async () => {
      moduleWrites.push("fulfillment.createFulfillmentSets")
      return { id: "fset_written" }
    }),
  }
  const query = {
    graph: async ({ entity }: { entity: string }) => {
      if (entity === "sales_channel") {
        return { data: records.channels ?? [] }
      }
      if (entity === "shipping_profile") {
        return { data: records.profiles ?? [] }
      }
      if (entity === "region") {
        return { data: records.regions ?? [] }
      }
      moduleWrites.push(`query ${entity}`)
      throw new Error(`unexpected query ${entity}`)
    },
  }
  const container = {
    resolve(key: string) {
      if (key === ContainerRegistrationKeys.LOGGER) {
        return { info() {}, warn() {} }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
        return { projectConfig: { databaseUrl } }
      }
      if (key === ContainerRegistrationKeys.LINK) {
        return link
      }
      if (key === Modules.FULFILLMENT) {
        return fulfillment
      }
      moduleWrites.push(`resolve ${String(key)}`)
      throw new Error(`unexpected resolve ${String(key)}`)
    },
  } as unknown as MedusaContainer

  return { container, moduleWrites, link, fulfillment }
}

const expectNoWrites = (store: ReturnType<typeof storeFor>) => {
  expect(store.moduleWrites).toEqual([])
  expect(store.link.create).not.toHaveBeenCalled()
  expect(store.fulfillment.createFulfillmentSets).not.toHaveBeenCalled()
  expect(flows.__workflow).not.toHaveBeenCalled()
  expect(flows.__run).not.toHaveBeenCalled()
  for (const name of WORKFLOW_NAMES) {
    expect(coreFlows[name]).not.toHaveBeenCalled()
  }
}

describe("ensureEcuadorStore preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pgState.connect.mockImplementation(async () => undefined)
    pgState.query.mockImplementation(async () => ({ rows: [] }))
    pgState.end.mockImplementation(async () => undefined)
  })

  it("releases the advisory lock when ensureEcuadorStore throws", async () => {
    const store = storeFor({
      channels: [
        { id: "sc_1", name: "Default Sales Channel" },
        { id: "sc_2", name: "Default Sales Channel" },
      ],
    })

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      MedusaError
    )

    expect(pgState.query).toHaveBeenNthCalledWith(1, LOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(pgState.query).toHaveBeenNthCalledWith(2, UNLOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(pgState.end).toHaveBeenCalledTimes(1)
    expect(pgState.query.mock.invocationCallOrder[0]).toBeLessThan(
      pgState.query.mock.invocationCallOrder[1]
    )
    expect(pgState.query.mock.invocationCallOrder[1]).toBeLessThan(
      pgState.end.mock.invocationCallOrder[0]
    )
    expect(ECUADOR_SETUP_LOCK_KEY).toBe(7482910365542101)
    expectNoWrites(store)
  })

  it("closes the lock connection without echoing the database URL when connect fails", async () => {
    const databaseUrl = "postgres://lock-user:s3cret@db.example.com:5432/store"
    const store = storeFor({}, databaseUrl)
    pgState.connect.mockRejectedValue(
      new Error(`connect failed for ${databaseUrl}`)
    )

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /Could not acquire the Ecuador store setup lock/
    )

    try {
      await ensureEcuadorStore({ container: store.container })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(databaseUrl)
      expect(message).not.toContain("s3cret")
      expect(message).not.toContain("db.example.com")
    }

    expect(pgState.query).not.toHaveBeenCalled()
    expect(pgState.end).toHaveBeenCalled()
    expectNoWrites(store)
  })

  it("writes nothing when more than one Default Sales Channel exists", async () => {
    const store = storeFor({
      channels: [
        { id: "sc_1", name: "Default Sales Channel" },
        { id: "sc_2", name: "Default Sales Channel" },
      ],
    })

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      MedusaError
    )
    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /sc_1/
    )
    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /Refusing to pick one/
    )
    expectNoWrites(store)
  })

  it("writes nothing when Default Shipping Profile belongs to another type", async () => {
    const store = storeFor({
      profiles: [
        { id: "sp_gift", name: "Default Shipping Profile", type: "gift" },
      ],
    })

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /sp_gift/
    )
    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /Refusing to create/
    )
    expectNoWrites(store)
  })

  it("writes nothing when more than one default shipping profile exists", async () => {
    const store = storeFor({
      profiles: [
        { id: "sp_1", name: "A", type: "default" },
        { id: "sp_2", name: "B", type: "default" },
      ],
    })

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /sp_1/
    )
    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /sp_2/
    )
    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      /Refusing to pick one/
    )
    expectNoWrites(store)
  })
})
