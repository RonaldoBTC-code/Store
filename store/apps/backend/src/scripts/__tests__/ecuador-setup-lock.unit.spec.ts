import { readFileSync } from "fs"
import { join } from "path"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  ECUADOR_SETUP_LOCK_KEY,
  ECUADOR_SETUP_LOCK_LIMIT_MS,
  withEcuadorSetupLock,
} from "../ecuador-setup-lock"

const TRY_LOCK_SQL = "SELECT pg_try_advisory_lock($1::bigint) AS acquired"
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint) AS unlocked"
const BUSY_MESSAGE =
  "Otro proceso está configurando la tienda Ecuador; reintenta en unos minutos"

type FakeConnection = {
  id: number
  query: jest.Mock
  __knex__disposed?: unknown
}

const containerFor = (client: {
  acquireConnection: jest.Mock
  releaseConnection: jest.Mock
  destroyRawConnection?: jest.Mock
}) =>
  ({
    resolve(key: string) {
      if (key !== ContainerRegistrationKeys.PG_CONNECTION) {
        throw new Error(`unexpected resolve ${key}`)
      }
      return { client }
    },
  }) as unknown as MedusaContainer

describe("withEcuadorSetupLock", () => {
  it("stops after five minutes without a URL and returns every missed connection", async () => {
    const databaseUrl = "postgres://lock-user:s3cret@db.example.com:5432/store"
    const outstanding = new Set<FakeConnection>()
    const connections: FakeConnection[] = []
    let nextId = 0
    const acquireConnection = jest.fn(async () => {
      const connection: FakeConnection = {
        id: nextId,
        query: jest.fn(async () => ({
          rows: [{ acquired: false, note: databaseUrl }],
        })),
      }
      nextId += 1
      connections.push(connection)
      outstanding.add(connection)
      return connection
    })
    const releaseConnection = jest.fn(async (connection: FakeConnection) => {
      outstanding.delete(connection)
    })
    let time = 0
    const sleeps: number[] = []
    const run = jest.fn(async () => undefined)

    let caught: unknown
    try {
      await withEcuadorSetupLock(
        containerFor({ acquireConnection, releaseConnection }),
        run,
        {
          now: () => time,
          sleep: async (ms) => {
            sleeps.push(ms)
            time += ms
          },
        }
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MedusaError)
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).toBe(BUSY_MESSAGE)
    expect(run).not.toHaveBeenCalled()
    expect(message).not.toContain(databaseUrl)
    expect(message).not.toContain("s3cret")
    expect(message).not.toContain("db.example.com")
    expect(message).not.toContain("postgres://")
    expect(connections.length).toBeGreaterThan(1)
    expect(releaseConnection).toHaveBeenCalledTimes(connections.length)
    for (const connection of connections) {
      expect(releaseConnection).toHaveBeenCalledWith(connection)
      expect(connection.query).toHaveBeenCalledWith(TRY_LOCK_SQL, [
        String(ECUADOR_SETUP_LOCK_KEY),
      ])
    }
    expect(outstanding.size).toBe(0)
    expect(time).toBeGreaterThanOrEqual(ECUADOR_SETUP_LOCK_LIMIT_MS)
    expect(sleeps.length).toBeGreaterThan(0)
    expect(sleeps.some((ms) => ms >= 1000)).toBe(true)
    expect(sleeps.every((ms) => ms > 0 && ms <= 9000)).toBe(true)
  })

  it("destroys the held connection when unlock throws", async () => {
    const connection: FakeConnection = {
      id: 1,
      query: jest.fn(async (sql: string) => {
        if (sql === TRY_LOCK_SQL) {
          return { rows: [{ acquired: true }] }
        }
        throw new Error("unlock failed postgres://lock-user:s3cret@db.example.com/store")
      }),
    }
    const outstanding = new Set<FakeConnection>([])
    const acquireConnection = jest.fn(async () => {
      outstanding.add(connection)
      return connection
    })
    const releaseConnection = jest.fn(async (released: FakeConnection) => {
      outstanding.delete(released)
    })
    const destroyRawConnection = jest.fn(async () => undefined)

    await expect(
      withEcuadorSetupLock(
        containerFor({
          acquireConnection,
          releaseConnection,
          destroyRawConnection,
        }),
        async () => "done"
      )
    ).resolves.toBe("done")

    expect(connection.__knex__disposed).toBe(true)
    expect(destroyRawConnection).toHaveBeenCalledTimes(1)
    expect(destroyRawConnection).toHaveBeenCalledWith(connection)
    expect(destroyRawConnection.mock.invocationCallOrder[0]).toBeLessThan(
      releaseConnection.mock.invocationCallOrder[0]
    )
    expect(releaseConnection).toHaveBeenCalledWith(connection)
    expect(outstanding.size).toBe(0)
  })

  it("destroys the held connection when unlock returns false", async () => {
    const connection: FakeConnection = {
      id: 2,
      query: jest.fn(async (sql: string) => {
        if (sql === TRY_LOCK_SQL) {
          return { rows: [{ acquired: true }] }
        }
        if (sql === UNLOCK_SQL) {
          return { rows: [{ unlocked: false }] }
        }
        return { rows: [] }
      }),
    }
    const acquireConnection = jest.fn(async () => connection)
    const releaseConnection = jest.fn(async () => undefined)
    const destroyRawConnection = jest.fn(async () => undefined)

    await withEcuadorSetupLock(
      containerFor({
        acquireConnection,
        releaseConnection,
        destroyRawConnection,
      }),
      async () => undefined
    )

    expect(connection.__knex__disposed).toBe(true)
    expect(destroyRawConnection).toHaveBeenCalledTimes(1)
    expect(destroyRawConnection).toHaveBeenCalledWith(connection)
    expect(releaseConnection).toHaveBeenCalledTimes(1)
    expect(releaseConnection).toHaveBeenCalledWith(connection)
    expect(destroyRawConnection.mock.invocationCallOrder[0]).toBeLessThan(
      releaseConnection.mock.invocationCallOrder[0]
    )
    expect(connection.query).toHaveBeenCalledWith(UNLOCK_SQL, [
      String(ECUADOR_SETUP_LOCK_KEY),
    ])
  })

  it("does not construct a pg client or disable certificate checks", () => {
    const source = readFileSync(
      join(__dirname, "../ecuador-setup-lock.ts"),
      "utf8"
    )
    expect(source).not.toContain("new Client")
    expect(source).not.toContain("rejectUnauthorized")
    expect(source).not.toContain('from "pg"')
    expect(source).not.toContain('require("pg")')
    expect(source).not.toContain("ssl:")
  })
})
