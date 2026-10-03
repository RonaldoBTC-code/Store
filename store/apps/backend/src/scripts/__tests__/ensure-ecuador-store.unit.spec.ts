import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import * as coreFlows from "@medusajs/medusa/core-flows"
import ensureEcuadorStore from "../ensure-ecuador-store"

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

const storeFor = (records: {
  channels?: { id: string; name?: string | null }[]
  profiles?: { id: string; name?: string | null; type?: string | null }[]
  regions?: {
    id: string
    name?: string | null
    currency_code?: string | null
    countries?: { iso_2?: string | null }[]
  }[]
}) => {
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
