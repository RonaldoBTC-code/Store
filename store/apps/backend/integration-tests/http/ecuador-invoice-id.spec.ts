import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"
import purgeAbandonedCartInvoiceIdsJob from "../../src/jobs/purge-abandoned-cart-tax-ids-job"

// Loaded at runtime so this spec can send the storefront payload without
// pulling the storefront package into the backend tsconfig rootDir.
function checkoutAddressesFromForm(
  formData: FormData,
  billingAddressId?: string | null
): {
  shipping_address?: Record<string, unknown>
  billing_address?: Record<string, unknown>
  email?: string
} {
  const loaded = require("../../../storefront/src/lib/data/checkout-addresses") as {
    checkoutAddressesFromForm: (
      formData: FormData,
      billingAddressId?: string | null
    ) => {
      shipping_address?: Record<string, unknown>
      billing_address?: Record<string, unknown>
      email?: string
    }
  }
  return loaded.checkoutAddressesFromForm(formData, billingAddressId)
}

jest.setTimeout(180 * 1000)

const CEDULA = "1710034065"
const RUC = "1710034065001"
const INVALID_CEDULA = "1710034066"
const LEGAL_NAME = "Taller Norte"
const PREVIOUS_COMPANY = "Nombre Viejo"
const COMPANY_ONLY = "Solo Nombre"
const PRIVATE_RUC = "1790085783001"
const NUMBER_MESSAGE =
  "Escribe el nombre de la empresa o persona, sin el número de RUC ni de cédula"

type AddressRow = {
  id: string
  company: string | null
  metadata: Record<string, unknown> | null
  deleted_at: Date | string | null
}

type Sql = {
  (table: string): {
    where(criteria: Record<string, unknown>): {
      first(): Promise<Record<string, unknown> | undefined>
      update(values: Record<string, unknown>): Promise<number>
    }
    whereIn(column: string, values: string[]): {
      select(...columns: string[]): Promise<AddressRow[]>
    }
    select(...columns: string[]): {
      whereRaw(sql: string, bindings: unknown[]): Promise<AddressRow[]>
    }
  }
  raw(sql: string, bindings?: unknown[]): Promise<unknown>
}

function metadataOf(row: AddressRow): Record<string, unknown> {
  if (!row.metadata) {
    return {}
  }

  if (typeof row.metadata === "string") {
    return JSON.parse(row.metadata) as Record<string, unknown>
  }

  return row.metadata
}

function assertAddressClean(row: AddressRow) {
  const metadata = metadataOf(row)
  expect(metadata).not.toHaveProperty("tax_id")
  expect(metadata).not.toHaveProperty("tax_id_type")
  expect(row.company ?? "").toBe("")
  expect(JSON.stringify(metadata)).not.toContain(CEDULA)
  expect(JSON.stringify(metadata)).not.toContain(RUC)
}

function messageOf(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error)
  }

  const record = error as {
    message?: string
    response?: { status?: number; data?: { message?: string } }
  }

  return record.response?.data?.message || record.message || ""
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    JWT_SECRET: "supersecret",
    COOKIE_SECRET: "supersecret",
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
  },
  testSuite: ({ getContainer, api }) => {
    describe("Ecuador invoice id against Postgres", () => {
      const http = api as {
        defaults: { headers: { common: Record<string, string> } }
        post(url: string, body?: unknown): Promise<unknown>
      }

      let salesChannelId = ""

      beforeAll(async () => {
        const apiKeyModule = getContainer().resolve(Modules.API_KEY) as {
          createApiKeys(data: {
            title: string
            type: "publishable"
            created_by: string
          }): Promise<{ token: string }>
        }
        const key = await apiKeyModule.createApiKeys({
          title: "Storefront",
          type: "publishable",
          created_by: "",
        })
        http.defaults.headers.common["x-publishable-api-key"] = key.token

        const salesChannelModule = getContainer().resolve(
          Modules.SALES_CHANNEL
        ) as {
          createSalesChannels(data: { name: string }): Promise<{ id: string }>
        }
        const channel = await salesChannelModule.createSalesChannels({
          name: "Default",
        })
        salesChannelId = channel.id
      })

      async function workflowMessage(run: Promise<unknown>) {
        try {
          await run
        } catch (error) {
          const message = messageOf(error)
          if (message) {
            return message
          }

          throw error
        }

        throw new Error("Expected the workflow to reject the invoice data")
      }

      async function rejectedPost(path: string, body?: unknown) {
        try {
          await http.post(path, body ?? {})
        } catch (error) {
          return error
        }

        throw new Error(`Expected ${path} to reject the invoice data`)
      }

      async function sql(): Promise<Sql> {
        return getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION) as Sql
      }

      async function seedRegion(countryCode = "ec", name = "Ecuador") {
        const regionModule = getContainer().resolve(Modules.REGION) as {
          createRegions(data: {
            name: string
            currency_code: string
            countries: string[]
          }): Promise<{ id: string }>
        }

        return regionModule.createRegions({
          name,
          currency_code: "usd",
          countries: [countryCode],
        })
      }

      async function createCart(input: {
        regionId: string
        company?: string
        metadata?: Record<string, unknown> | null
        shipping?: boolean
      }) {
        const cartModule = getContainer().resolve(Modules.CART) as unknown as {
          createCarts(data: Record<string, unknown>): Promise<{
            id: string
            billing_address?: { id: string } | null
          }>
        }

        const billing: Record<string, unknown> = {
          first_name: "Ana",
          last_name: "Perez",
          address_1: "Av Amazonas",
          city: "Quito",
          country_code: "ec",
          phone: "0991234567",
        }

        if (input.company !== undefined) {
          billing.company = input.company
        }

        if (input.metadata !== undefined) {
          billing.metadata = input.metadata
        }

        const data: Record<string, unknown> = {
          currency_code: "usd",
          region_id: input.regionId,
          sales_channel_id: salesChannelId,
          email: "ana@example.com",
          billing_address: billing,
        }

        if (input.shipping) {
          data.shipping_address = {
            first_name: "Ana",
            last_name: "Perez",
            address_1: "Av Amazonas",
            city: "Quito",
            country_code: "ec",
            phone: "0991234567",
          }
        }

        return cartModule.createCarts(data)
      }

      async function ageCart(cartId: string) {
        const db = await sql()
        await db("cart")
          .where({ id: cartId })
          .update({
            updated_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          })
      }

      async function addressRows(ids: string[], needles: string[]) {
        const db = await sql()
        const byId = ids.length
          ? await db("cart_address").whereIn("id", ids).select("id", "company", "metadata", "deleted_at")
          : []
        const clauses = needles
          .map(() => "COALESCE(metadata::text, '') LIKE ? OR COALESCE(company, '') = ?")
          .join(" OR ")
        const bindings = needles.flatMap((needle) => [`%${needle}%`, needle])
        const byValue = clauses
          ? await db("cart_address")
              .select("id", "company", "metadata", "deleted_at")
              .whereRaw(clauses, bindings)
          : []
        const rows = new Map<string, AddressRow>()

        for (const row of [...byId, ...byValue]) {
          rows.set(row.id, row)
        }

        return [...rows.values()]
      }

      it("clears an abandoned RUC cart, keeps a completed order, and clears a company-only cart", async () => {
        const region = await seedRegion()
        const abandoned = await createCart({
          regionId: region.id,
          company: LEGAL_NAME,
          metadata: { tax_id: RUC, tax_id_type: "ruc", note: "keep" },
        })
        const companyOnly = await createCart({
          regionId: region.id,
          company: COMPANY_ONLY,
        })
        const abandonedAddressId = abandoned.billing_address?.id
        const companyAddressId = companyOnly.billing_address?.id
        expect(abandonedAddressId).toBeTruthy()
        expect(companyAddressId).toBeTruthy()

        const orderModule = getContainer().resolve(Modules.ORDER) as {
          createOrders(data: Record<string, unknown>): Promise<{
            id: string
            billing_address?: { id: string } | null
          }>
        }
        const order = await orderModule.createOrders({
          currency_code: "usd",
          email: "ana@example.com",
          region_id: region.id,
          billing_address: {
            first_name: "Ana",
            last_name: "Perez",
            address_1: "Calle Larga",
            city: "Cuenca",
            country_code: "ec",
            phone: "0987654321",
            metadata: { tax_id: CEDULA, tax_id_type: "cedula" },
          },
        })
        const orderAddressId = order.billing_address?.id
        expect(orderAddressId).toBeTruthy()

        const recent = await createCart({
          regionId: region.id,
          company: "Reciente Sociedad",
          metadata: { tax_id: "linked-marker", tax_id_type: "cedula" },
        })
        const recentAddressId = recent.billing_address?.id as string
        expect(recentAddressId).toBeTruthy()

        const db = await sql()
        const orphanId = "caaddr_01ORPHANINVOICEADDRESS01"
        await db.raw(
          `INSERT INTO cart_address (id, company, metadata, deleted_at, created_at, updated_at)
           VALUES (?, ?, ?::jsonb, NOW(), NOW(), NOW())`,
          [
            orphanId,
            LEGAL_NAME,
            JSON.stringify({
              tax_id: CEDULA,
              tax_id_type: "cedula",
              note: "orphan",
            }),
          ]
        )
        await db("cart_address")
          .where({ id: recentAddressId })
          .update({ deleted_at: new Date() })

        await ageCart(abandoned.id)
        await ageCart(companyOnly.id)
        const firstPass = await purgeAbandonedCartInvoiceIdsJob(getContainer())
        expect(firstPass).toBeGreaterThan(0)

        const abandonedCart = await db("cart").where({ id: abandoned.id }).first()
        const companyCart = await db("cart").where({ id: companyOnly.id }).first()
        const recentCart = await db("cart").where({ id: recent.id }).first()
        expect(abandonedCart?.billing_address_id).toBe(abandonedAddressId)
        expect(companyCart?.billing_address_id).toBe(companyAddressId)
        expect(recentCart?.billing_address_id).toBe(recentAddressId)

        const kept = await db("cart_address").where({ id: recentAddressId }).first()
        expect(kept?.deleted_at).toBeTruthy()
        expect(kept?.company).toBe("Reciente Sociedad")
        expect(metadataOf(kept as AddressRow).tax_id).toBe("linked-marker")

        const orphan = await db("cart_address").where({ id: orphanId }).first()
        expect(orphan?.deleted_at).toBeTruthy()
        expect(orphan?.company ?? "").toBe("")
        expect(metadataOf(orphan as AddressRow)).toEqual({ note: "orphan" })

        const cartAddresses = await addressRows(
          [
            abandonedAddressId as string,
            companyAddressId as string,
            orphanId,
          ],
          [RUC, CEDULA, LEGAL_NAME, COMPANY_ONLY]
        )
        expect(cartAddresses.map((row) => row.id).sort()).toEqual(
          [abandonedAddressId, companyAddressId, orphanId].sort()
        )
        for (const row of cartAddresses) {
          assertAddressClean(row)
          const text = `${row.company ?? ""}\n${JSON.stringify(metadataOf(row))}`
          expect(text).not.toContain(CEDULA)
          expect(text).not.toContain(RUC)
          expect(text).not.toContain(LEGAL_NAME)
          expect(text).not.toContain(COMPANY_ONLY)
        }

        const orderRows = await db("order_address")
          .whereIn("id", [orderAddressId as string])
          .select("id", "company", "metadata", "deleted_at")
        expect(orderRows).toHaveLength(1)
        expect(metadataOf(orderRows[0]).tax_id).toBe(CEDULA)
        expect(metadataOf(orderRows[0]).tax_id_type).toBe("cedula")

        await ageCart(abandoned.id)
        await ageCart(companyOnly.id)
        const secondPass = await purgeAbandonedCartInvoiceIdsJob(getContainer())
        expect(secondPass).toBe(0)
        const orderAfter = await db("order_address")
          .whereIn("id", [orderAddressId as string])
          .select("id", "company", "metadata", "deleted_at")
        expect(metadataOf(orderAfter[0]).tax_id).toBe(CEDULA)
        const orphanAfter = await db("cart_address").where({ id: orphanId }).first()
        expect(orphanAfter?.deleted_at).toBeTruthy()
        expect(metadataOf(orphanAfter as AddressRow)).toEqual({ note: "orphan" })
      })

      it("rejects an invalid tax id and razón social in the update workflow and the store route", async () => {
        const region = await seedRegion()
        const cart = await createCart({
          regionId: region.id,
          company: LEGAL_NAME,
          metadata: { tax_id: RUC, tax_id_type: "ruc" },
        })
        const addressId = cart.billing_address?.id as string

        const invalidTax = {
          id: cart.id,
          billing_address: {
            id: addressId,
            phone: "0991234567",
            company: LEGAL_NAME,
            metadata: { tax_id: INVALID_CEDULA, tax_id_type: "cedula" },
          },
        }
        const invalidName = {
          id: cart.id,
          billing_address: {
            id: addressId,
            phone: "0991234567",
            company: `Juan Pérez ${RUC.slice(0, 10)}`,
            metadata: { tax_id: RUC, tax_id_type: "ruc" },
          },
        }

        expect(
          await workflowMessage(
            updateCartWorkflow(getContainer()).run({ input: invalidTax })
          )
        ).toMatch(/cédula/)
        expect(
          await workflowMessage(
            updateCartWorkflow(getContainer()).run({ input: invalidName })
          )
        ).toMatch(/sin el número de RUC/)

        const routeTax = await rejectedPost(`/store/carts/${cart.id}`, {
          billing_address: invalidTax.billing_address,
        })
        const routeName = await rejectedPost(`/store/carts/${cart.id}`, {
          billing_address: invalidName.billing_address,
        })

        expect(messageOf(routeTax)).toContain("cédula")
        expect(messageOf(routeTax)).not.toContain(INVALID_CEDULA)
        expect(messageOf(routeName)).toBe(NUMBER_MESSAGE)
        expect(messageOf(routeName)).not.toContain(RUC.slice(0, 10))

        const rows = await addressRows([addressId], [RUC, LEGAL_NAME])
        expect(rows).toHaveLength(1)
        expect(rows[0].deleted_at).toBeNull()
        expect(metadataOf(rows[0]).tax_id).toBe(RUC)
        expect(rows[0].company).toBe(LEGAL_NAME)
      })

      it("accepts an empty company without invoice metadata and rejects a non-empty one", async () => {
        const region = await seedRegion()
        const cart = await createCart({
          regionId: region.id,
          company: LEGAL_NAME,
          metadata: { tax_id: CEDULA, tax_id_type: "cedula" },
        })
        const addressId = cart.billing_address?.id as string
        const kept = {
          id: cart.id,
          billing_address: {
            id: addressId,
            phone: "0991234567",
            company: "Otro Nombre",
          },
        }

        expect(
          await workflowMessage(
            updateCartWorkflow(getContainer()).run({ input: kept })
          )
        ).toMatch(/razón social solo se usa/)

        const route = await rejectedPost(`/store/carts/${cart.id}`, {
          billing_address: kept.billing_address,
        })
        expect(messageOf(route)).toContain("razón social solo se usa")
        expect(messageOf(route)).not.toContain("Otro Nombre")

        const cleared = {
          id: cart.id,
          billing_address: {
            id: addressId,
            phone: "0991234567",
            company: "",
          },
        }
        await updateCartWorkflow(getContainer()).run({ input: cleared })

        const db = await sql()
        const cartRow = await db("cart").where({ id: cart.id }).first()
        expect(cartRow?.billing_address_id).toBe(addressId)
        const rows = await addressRows([addressId], [CEDULA, LEGAL_NAME])
        const current = rows.find((row) => row.id === addressId)
        expect(current?.company ?? "").toBe("")
        expect(metadataOf(current as AddressRow).tax_id).toBe(CEDULA)
      })

      async function makeCartPayable(cartId: string, regionId: string) {
        const cartModule = getContainer().resolve(Modules.CART) as unknown as {
          addLineItems(
            cartId: string,
            items: {
              title: string
              quantity: number
              unit_price: number
              requires_shipping: boolean
              is_custom_price: boolean
            }[]
          ): Promise<unknown>
        }
        await cartModule.addLineItems(cartId, [
          {
            title: "Pieza",
            quantity: 1,
            unit_price: 10,
            requires_shipping: false,
            is_custom_price: true,
          },
        ])

        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as {
          create(
            data: Record<string, Record<string, string>>
          ): Promise<unknown>
        }
        await link.create({
          [Modules.REGION]: { region_id: regionId },
          [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
        })

        const collection = await createPaymentCollectionForCartWorkflow(
          getContainer()
        ).run({
          input: { cart_id: cartId },
        })

        await createPaymentSessionsWorkflow(getContainer()).run({
          input: {
            payment_collection_id: collection.result.id,
            provider_id: "pp_system_default",
          },
        })
      }

      it("rejects completion of a cart whose razón social contains the cédula inside the RUC", async () => {
        const region = await seedRegion()
        const cart = await createCart({
          regionId: region.id,
          company: `Juan Pérez ${RUC.slice(0, 10)}`,
          metadata: { tax_id: RUC, tax_id_type: "ruc" },
        })
        await makeCartPayable(cart.id, region.id)

        expect(
          await workflowMessage(
            completeCartWorkflow(getContainer()).run({ input: { id: cart.id } })
          )
        ).toMatch(/sin el número de RUC/)

        const route = await rejectedPost(`/store/carts/${cart.id}/complete`)

        expect(messageOf(route)).toBe(NUMBER_MESSAGE)
        expect(messageOf(route)).not.toContain(RUC.slice(0, 10))
      })

      function checkoutForm(fields: Record<string, string>) {
        const data = new FormData()
        for (const [key, value] of Object.entries(fields)) {
          data.set(key, value)
        }
        data.set("same_as_billing", "on")
        return data
      }

      it("sends the saved billing address id from checkout", async () => {
        const region = await seedRegion()
        const cart = await createCart({
          regionId: region.id,
          company: PREVIOUS_COMPANY,
          metadata: { tax_id: CEDULA, tax_id_type: "cedula", note: "keep" },
          shipping: true,
        })
        const billingId = cart.billing_address?.id as string
        const db = await sql()
        const before = await db("cart").where({ id: cart.id }).first()
        const shippingId = before?.shipping_address_id as string
        expect(billingId).toBeTruthy()
        expect(shippingId).toBeTruthy()

        const update = checkoutAddressesFromForm(
          checkoutForm({
            "shipping_address.first_name": "Ana",
            "shipping_address.last_name": "Perez",
            "shipping_address.address_1": "Av Amazonas",
            "shipping_address.city": "Quito",
            "shipping_address.country_code": "ec",
            "shipping_address.province": "Pichincha",
            "shipping_address.phone": "0991234567",
            email: "ana@example.com",
            "billing_address.tax_id_type": "ruc",
            "billing_address.tax_id": PRIVATE_RUC,
            "billing_address.company": LEGAL_NAME,
          }),
          billingId
        )
        expect(update.billing_address?.id).toBe(billingId)
        expect(update.shipping_address).not.toHaveProperty("id")

        await http.post(`/store/carts/${cart.id}`, update)

        const after = await db("cart").where({ id: cart.id }).first()
        expect(after?.billing_address_id).toBe(billingId)
        expect(after?.shipping_address_id).toBe(shippingId)

        const leaked = await db("cart_address")
          .select("id", "company", "metadata", "deleted_at")
          .whereRaw(
            "COALESCE(metadata::text, '') LIKE ? OR COALESCE(company, '') = ?",
            [`%${CEDULA}%`, PREVIOUS_COMPANY]
          )
        expect(leaked).toEqual([])

        const current = await db("cart_address").where({ id: billingId }).first()
        expect(current?.deleted_at ?? null).toBeNull()
        expect(metadataOf(current as AddressRow).tax_id).toBe(PRIVATE_RUC)
        expect(metadataOf(current as AddressRow).tax_id_type).toBe("ruc")
        expect(current?.company).toBe(LEGAL_NAME)
      })

      it("removes invoice keys when metadata is set to an empty string", async () => {
        const region = await seedRegion()
        const cart = await createCart({
          regionId: region.id,
          company: LEGAL_NAME,
          metadata: { tax_id: RUC, tax_id_type: "ruc", note: "keep" },
        })
        const addressId = cart.billing_address?.id as string
        await ageCart(cart.id)
        const cleared = await purgeAbandonedCartInvoiceIdsJob(getContainer())
        expect(cleared).toBeGreaterThan(0)

        const db = await sql()
        const cleaned = await db("cart_address").where({ id: addressId }).first()
        const cleanedMetadata = metadataOf(cleaned as AddressRow)
        expect(cleanedMetadata).not.toHaveProperty("tax_id")
        expect(cleanedMetadata).not.toHaveProperty("tax_id_type")
        expect(JSON.stringify(cleanedMetadata)).not.toContain('""')
        expect(cleanedMetadata.note).toBe("keep")
        expect(cleaned?.company ?? "").toBe("")

        await db("cart_address")
          .where({ id: addressId })
          .update({
            metadata: {
              tax_id: "",
              tax_id_type: "",
              note: "keep",
            },
            company: "",
          })
        await ageCart(cart.id)
        const second = await purgeAbandonedCartInvoiceIdsJob(getContainer())
        expect(second).toBe(0)

        const stored = await db("cart_address").where({ id: addressId }).first()
        expect(metadataOf(stored as AddressRow)).toEqual({
          tax_id: "",
          tax_id_type: "",
          note: "keep",
        })
        expect(stored?.company ?? "").toBe("")
      })

      it("accepts a region change that builds a shipping address without a phone", async () => {
        const ecuador = await seedRegion()
        const peru = await seedRegion("pe", "Peru")
        const cart = await createCart({
          regionId: ecuador.id,
          metadata: { tax_id: CEDULA, tax_id_type: "cedula" },
        })

        await updateCartWorkflow(getContainer()).run({
          input: { id: cart.id, region_id: peru.id },
        })

        const db = await sql()
        const updated = await db("cart").where({ id: cart.id }).first()
        expect(updated?.region_id).toBe(peru.id)
        const shippingId = updated?.shipping_address_id as string
        expect(shippingId).toBeTruthy()
        const shipping = await db("cart_address").where({ id: shippingId }).first()
        expect(shipping?.country_code).toBe("pe")
        expect(shipping?.phone ?? null).toBeNull()

        const missingPhone = await rejectedPost(`/store/carts/${cart.id}`, {
          shipping_address: {
            first_name: "Ana",
            last_name: "Perez",
            address_1: "Av Larco",
            city: "Lima",
            country_code: "pe",
          },
          billing_address: {
            first_name: "Ana",
            last_name: "Perez",
            address_1: "Av Larco",
            city: "Lima",
            country_code: "pe",
            phone: "0991234567",
            metadata: { tax_id: CEDULA, tax_id_type: "cedula" },
          },
        })
        expect(messageOf(missingPhone)).toBe("Shipping phone is required.")

        await makeCartPayable(cart.id, peru.id)
        expect(
          await workflowMessage(
            completeCartWorkflow(getContainer()).run({ input: { id: cart.id } })
          )
        ).toBe("Shipping phone is required.")
      })
    })
  },
})
