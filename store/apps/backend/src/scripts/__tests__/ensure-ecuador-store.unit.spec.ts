import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import * as coreFlows from "@medusajs/medusa/core-flows"
import { ECUADOR_SETUP_LOCK_KEY } from "../ecuador-setup-lock"
import ensureEcuadorStore from "../ensure-ecuador-store"

const TRY_LOCK_SQL = "SELECT pg_try_advisory_lock($1::bigint) AS acquired"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint) AS unlocked"

type LockConnection = {
  query: jest.Mock
  __knex__disposed?: unknown
}

const lockClients: {
  connection: LockConnection
  acquireConnection: jest.Mock
  releaseConnection: jest.Mock
  destroyRawConnection: jest.Mock
}[] = []

const installLockClient = () => {
  const connection: LockConnection = {
    query: jest.fn(async (sql: string) => {
      if (sql === TRY_LOCK_SQL) {
        return { rows: [{ acquired: true }] }
      }
      if (sql === UNLOCK_SQL) {
        return { rows: [{ unlocked: true }] }
      }
      return { rows: [] }
    }),
  }
  const acquireConnection = jest.fn(async () => connection)
  const releaseConnection = jest.fn(async () => undefined)
  const destroyRawConnection = jest.fn(async () => undefined)
  lockClients.splice(0, lockClients.length, {
    connection,
    acquireConnection,
    releaseConnection,
    destroyRawConnection,
  })
  return lockClients[0]
}

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
    emptyReads?: boolean
  },
  _databaseUrl = "postgres://lock@127.0.0.1:5432/ecuador_lock_test"
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
      return {
        id: "fset_written",
        service_zones: [{ id: "serzo_written", name: "Ecuador" }],
      }
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
      if (records.emptyReads) {
        return { data: [] }
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
      if (key === ContainerRegistrationKeys.PG_CONNECTION) {
        const current = lockClients[0]
        return {
          client: {
            acquireConnection: current.acquireConnection,
            releaseConnection: current.releaseConnection,
            destroyRawConnection: current.destroyRawConnection,
          },
        }
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
    installLockClient()
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

    const { connection, acquireConnection, releaseConnection, destroyRawConnection } =
      lockClients[0]
    expect(acquireConnection).toHaveBeenCalledTimes(1)
    expect(connection.query).toHaveBeenNthCalledWith(1, TRY_LOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(connection.query).toHaveBeenNthCalledWith(2, UNLOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(releaseConnection).toHaveBeenCalledTimes(1)
    expect(releaseConnection).toHaveBeenCalledWith(connection)
    expect(destroyRawConnection).not.toHaveBeenCalled()
    expect(connection.query.mock.invocationCallOrder[0]).toBeLessThan(
      connection.query.mock.invocationCallOrder[1]
    )
    expect(connection.query.mock.invocationCallOrder[1]).toBeLessThan(
      releaseConnection.mock.invocationCallOrder[0]
    )
    expect(ECUADOR_SETUP_LOCK_KEY).toBe(7482910365542101)
    expectNoWrites(store)
  })

  it("releases the container connection and names the cause code without the database URL", async () => {
    const databaseUrl = "postgres://lock-user:s3cret@db.example.com:5432/store"
    const store = storeFor({}, databaseUrl)
    const { connection, acquireConnection, releaseConnection } = lockClients[0]
    acquireConnection.mockRejectedValue(
      Object.assign(new Error(`connect ECONNREFUSED ${databaseUrl}`), {
        code: "ECONNREFUSED",
      })
    )

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      "Could not acquire the Ecuador store setup lock (ECONNREFUSED)."
    )

    try {
      await ensureEcuadorStore({ container: store.container })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toBe(
        "Could not acquire the Ecuador store setup lock (ECONNREFUSED)."
      )
      expect(message).not.toContain(databaseUrl)
      expect(message).not.toContain("s3cret")
      expect(message).not.toContain("db.example.com")
    }

    expect(connection.query).not.toHaveBeenCalled()
    expect(releaseConnection).not.toHaveBeenCalled()
    expectNoWrites(store)
  })

  it("names SSL when the connection error has no safe code", async () => {
    const databaseUrl = "postgres://lock-user:s3cret@db.example.com:5432/store"
    const store = storeFor({}, databaseUrl)
    const { connection, releaseConnection } = lockClients[0]
    connection.query.mockRejectedValue(
      new Error(`The server does not support SSL connections ${databaseUrl}`)
    )

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      "Could not acquire the Ecuador store setup lock (SSL)."
    )

    let message = ""
    try {
      await ensureEcuadorStore({ container: store.container })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain(databaseUrl)
    expect(message).not.toContain("s3cret")
    expect(message).not.toContain("db.example.com")
    expect(releaseConnection).toHaveBeenCalledWith(connection)
    expectNoWrites(store)
  })

  it("names a Postgres auth code without copying the error text", async () => {
    const databaseUrl = "postgres://lock-user:s3cret@db.example.com:5432/store"
    const store = storeFor({}, databaseUrl)
    lockClients[0].connection.query.mockRejectedValue(
      Object.assign(new Error(`password authentication failed for ${databaseUrl}`), {
        code: "28P01",
      })
    )

    await expect(ensureEcuadorStore({ container: store.container })).rejects.toThrow(
      "Could not acquire the Ecuador store setup lock (28P01)."
    )
    expectNoWrites(store)
  })

  it("writes after a ready preflight", async () => {
    const store = storeFor({ emptyReads: true })

    await expect(
      ensureEcuadorStore({ container: store.container })
    ).resolves.toBeUndefined()

    const inputs = flows.__run.mock.calls.map(
      (call) => call[0] as { input?: unknown } | undefined
    )
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input: expect.objectContaining({
            salesChannelsData: [
              expect.objectContaining({ name: "Default Sales Channel" }),
            ],
          }),
        }),
        expect.objectContaining({
          input: expect.objectContaining({
            data: [
              expect.objectContaining({
                name: "Default Shipping Profile",
                type: "default",
              }),
            ],
          }),
        }),
      ])
    )
    expect(store.fulfillment.createFulfillmentSets).toHaveBeenCalled()
    expect(store.link.create).toHaveBeenCalled()
    const { connection, releaseConnection, destroyRawConnection } = lockClients[0]
    expect(connection.query).toHaveBeenNthCalledWith(1, TRY_LOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(connection.query).toHaveBeenNthCalledWith(2, UNLOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
    expect(releaseConnection).toHaveBeenCalledTimes(1)
    expect(releaseConnection).toHaveBeenCalledWith(connection)
    expect(destroyRawConnection).not.toHaveBeenCalled()
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
