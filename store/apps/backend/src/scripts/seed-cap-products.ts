import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  CAP_OPTION_COLOR,
  CAP_OPTION_TALLA,
  capCategory,
  capCollection,
  capProducts,
  listMissingCapSeedFields,
  type CapSeed,
} from "../data/cap-products"

const ECUADOR_LOCATION_NAME = "Ecuador"

type IdRecord = { id: string }

type ProductRecord = {
  id: string
  handle?: string | null
  collection?: IdRecord | null
  categories?: IdRecord[] | null
  sales_channels?: IdRecord[] | null
  variants?: {
    id: string
    sku?: string | null
    inventory_items?: { inventory_item_id?: string | null }[] | null
  }[] | null
}

type InventoryLevelRecord = {
  id: string
  inventory_item_id?: string | null
  location_id?: string | null
}

/**
 * Creates the four Gato Gang caps from `src/data/cap-products.ts`.
 * Refuses to run while sku, price, or stock are still TODO.
 */
export default async function seedCapProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const missing = listMissingCapSeedFields()

  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      [
        "Cap seed refused. Fill the TODO values in src/data/cap-products.ts.",
        "These values are not in the repo, so the seed will not invent them:",
        ...missing.map((field) => `- ${field}`),
      ].join("\n")
    )
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })
  const location = (
    (locations ?? []) as { id: string; name?: string | null }[]
  ).find((entry) => entry.name === ECUADOR_LOCATION_NAME)

  if (!location) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Ecuador stock location not found. Run pnpm seed:ec before pnpm seed:caps."
    )
  }

  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const salesChannel = (
    (channels ?? []) as { id: string; name?: string | null }[]
  )[0]
  if (!salesChannel) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No sales channel found. Run pnpm seed:ec first."
    )
  }

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "type"],
  })
  const profilesList = (profiles ?? []) as { id: string; type?: string | null }[]
  const shippingProfile =
    profilesList.find((profile) => profile.type === "default") ?? profilesList[0]
  if (!shippingProfile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No shipping profile found. Run pnpm seed:ec first."
    )
  }

  const collectionId = await ensureCollection(container, query, logger)
  const categoryId = await ensureCategory(container, query, logger)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "collection.id",
      "categories.id",
      "sales_channels.id",
      "variants.id",
      "variants.sku",
      "variants.inventory_items.inventory_item_id",
    ],
  })
  const existingProducts = (products ?? []) as ProductRecord[]

  for (const cap of capProducts) {
    const existing = existingProducts.find((product) => product.handle === cap.handle)
    if (existing) {
      await ensureExistingProduct(
        container,
        link,
        logger,
        existing,
        cap,
        collectionId,
        categoryId,
        salesChannel.id,
        location.id
      )
      continue
    }

    const priceUsd = cap.priceUsd as number
    const stockedQuantity = cap.stockedQuantity as number
    const sku = cap.sku as string

    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: cap.title,
            handle: cap.handle,
            description: cap.description,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfile.id,
            collection_id: collectionId,
            category_ids: [categoryId],
            options: [
              { title: CAP_OPTION_TALLA, values: [cap.talla] },
              { title: CAP_OPTION_COLOR, values: [cap.color] },
            ],
            variants: [
              {
                title: `${cap.talla} / ${cap.color}`,
                sku,
                manage_inventory: true,
                allow_backorder: false,
                options: {
                  [CAP_OPTION_TALLA]: cap.talla,
                  [CAP_OPTION_COLOR]: cap.color,
                },
                prices: [
                  {
                    amount: priceUsd,
                    currency_code: "usd",
                  },
                ],
              },
            ],
            sales_channels: [{ id: salesChannel.id }],
          },
        ],
      },
    })
    logger.info(`Created ${cap.title} (${cap.handle}).`)

    const inventoryItemId = await findInventoryItemId(query, sku)
    await ensureInventoryLevel(
      container,
      query,
      logger,
      inventoryItemId,
      location.id,
      stockedQuantity,
      cap.handle
    )
  }

  logger.info("Cap catalog seed complete.")
}

async function ensureCollection(
  container: ExecArgs["container"],
  query: { graph: Function },
  logger: { info: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "product_collection",
    fields: ["id", "handle", "title"],
  })
  const existing = (
    (data ?? []) as { id: string; handle?: string | null }[]
  ).find((collection) => collection.handle === capCollection.handle)

  if (existing) {
    logger.info(`Collection ${capCollection.handle} already exists.`)
    return existing.id
  }

  const { result } = await createCollectionsWorkflow(container).run({
    input: {
      collections: [
        {
          title: capCollection.title,
          handle: capCollection.handle,
        },
      ],
    },
  })
  logger.info(`Created collection ${capCollection.handle}.`)
  return result[0].id
}

async function ensureCategory(
  container: ExecArgs["container"],
  query: { graph: Function },
  logger: { info: (message: string) => void }
) {
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "name"],
  })
  const existing = (
    (data ?? []) as { id: string; handle?: string | null }[]
  ).find((category) => category.handle === capCategory.handle)

  if (existing) {
    logger.info(`Category ${capCategory.handle} already exists.`)
    return existing.id
  }

  const { result } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: capCategory.name,
          handle: capCategory.handle,
          description: capCategory.description,
          is_active: true,
        },
      ],
    },
  })
  logger.info(`Created category ${capCategory.handle}.`)
  return result[0].id
}

async function ensureExistingProduct(
  container: ExecArgs["container"],
  link: { create: (data: object) => Promise<unknown> },
  logger: { info: (message: string) => void },
  product: ProductRecord,
  cap: CapSeed,
  collectionId: string,
  categoryId: string,
  salesChannelId: string,
  locationId: string
) {
  logger.info(`Product ${cap.handle} already exists. Leaving its copy unchanged.`)

  const update: {
    collection_id?: string
    category_ids?: string[]
  } = {}

  if (!product.collection?.id) {
    update.collection_id = collectionId
  }

  const categoryIds = (product.categories ?? []).map((category) => category.id)
  if (!categoryIds.includes(categoryId)) {
    update.category_ids = [...categoryIds, categoryId]
  }

  if (Object.keys(update).length) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: product.id },
        update,
      },
    })
  }

  const linked = product.sales_channels?.some(
    (channel) => channel.id === salesChannelId
  )
  if (!linked) {
    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already exists|duplicate|multiple links/i.test(message)) {
        throw error
      }
    }
  }

  const sku = cap.sku as string
  const variant = product.variants?.find((entry) => entry.sku === sku)
  const inventoryItemId =
    variant?.inventory_items?.find((item) => item.inventory_item_id)
      ?.inventory_item_id ?? null

  if (!inventoryItemId) {
    logger.info(
      `No inventory item for ${cap.handle} sku ${sku}. Stock was not changed.`
    )
    return
  }

  await ensureInventoryLevel(
    container,
    container.resolve(ContainerRegistrationKeys.QUERY),
    logger,
    inventoryItemId,
    locationId,
    cap.stockedQuantity as number,
    cap.handle
  )
}

async function findInventoryItemId(
  query: { graph: Function },
  sku: string
) {
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["sku", "inventory_items.inventory_item_id"],
    filters: { sku },
  })
  const variant = (
    (variants ?? []) as {
      inventory_items?: { inventory_item_id?: string | null }[] | null
    }[]
  )[0]
  const fromVariant = variant?.inventory_items?.find(
    (item) => item.inventory_item_id
  )?.inventory_item_id

  if (fromVariant) {
    return fromVariant
  }

  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: { sku },
  })
  const item = ((items ?? []) as { id: string }[])[0]
  if (!item) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Inventory item for sku ${sku} was not created.`
    )
  }
  return item.id
}

async function ensureInventoryLevel(
  container: ExecArgs["container"],
  query: { graph: Function },
  logger: { info: (message: string) => void },
  inventoryItemId: string,
  locationId: string,
  stockedQuantity: number,
  handle: string
) {
  const { data } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id", "location_id"],
    filters: {
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    },
  })
  const existing = ((data ?? []) as InventoryLevelRecord[]).find(
    (level) =>
      level.inventory_item_id === inventoryItemId &&
      level.location_id === locationId
  )

  if (existing) {
    logger.info(`Inventory level for ${handle} already exists.`)
    return
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItemId,
          location_id: locationId,
          stocked_quantity: stockedQuantity,
        },
      ],
    },
  })
  logger.info(`Set inventory for ${handle} at the Ecuador location.`)
}
