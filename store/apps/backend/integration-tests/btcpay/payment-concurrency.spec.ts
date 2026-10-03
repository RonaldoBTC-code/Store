import { isUniqueViolation } from "../../src/modules/btcpay/claim"
import { hashClientIp, hashSessionId } from "../../src/modules/btcpay/limits"
import {
  acquirePaymentSlot,
  confirmSettlement,
  newClaimId,
  pgTx,
  redactClosedPersonalData,
} from "../../src/modules/btcpay/payment-sql"
import {
  migration143000Up,
  migration160000Down,
  migration160000Up,
  migration170000Down,
  migration170000Up,
} from "../../src/modules/btcpay-claim/migrations/sql"

const SECRET = "server-secret"
const DATABASE_URL =
  process.env.BTCPAY_TEST_DATABASE_URL || process.env.DATABASE_URL || ""

type QueryResult = { rows: Record<string, unknown>[] }

type PgClient = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>
  release(): void
}

type PgPool = {
  query(sql: string, params?: unknown[]): Promise<QueryResult>
  connect(): Promise<PgClient>
  end(): Promise<void>
}

function createPool(connectionString: string): PgPool {
  const loaded = require("pg") as {
    Pool: new (config: { connectionString: string }) => PgPool
  }
  return new loaded.Pool({ connectionString })
}

async function runAll(pool: PgPool, statements: string[]) {
  for (const statement of statements) {
    await pool.query(statement)
  }
}

function acquireInput(overrides: {
  cartId: string
  sessionId: string
  customerId?: string | null
  ip?: string | null
}) {
  return {
    cartId: overrides.cartId,
    paymentSessionId: hashSessionId(overrides.sessionId, SECRET) as string,
    customerId: overrides.customerId ?? null,
    ipHash: overrides.ip ? hashClientIp(overrides.ip, SECRET) : null,
    units: 1,
    amountCents: 2500,
    now: new Date(),
    limits: {
      maxPendingPerCart: 1,
      maxPendingPerSession: 1,
      maxPendingPerCustomer: 2,
      maxNewInvoicesPerIp: 5,
      newInvoiceWindowSeconds: 3600,
      maxUnitsPerPendingOrder: 4,
    },
  }
}

describe("BTCPay Postgres constraints", () => {
  let pool: PgPool

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error(
        "BTCPay Postgres integration tests need BTCPAY_TEST_DATABASE_URL or DATABASE_URL."
      )
    }
    pool = createPool(DATABASE_URL)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_payment" CASCADE`)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_invoice_claim" CASCADE`)
    await runAll(pool, [
      ...migration143000Up,
      ...migration160000Up,
      ...migration170000Up,
    ])
  })

  afterAll(async () => {
    if (pool) {
      await pool.end()
    }
  })

  beforeEach(async () => {
    await pool.query(`TRUNCATE "btcpay_payment", "btcpay_invoice_claim"`)
  })

  it("stores integer cents and no float amount columns", async () => {
    const columns = await pool.query(
      `SELECT "column_name", "data_type"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('btcpay_payment', 'btcpay_invoice_claim')`
    )
    const byName = new Map(
      columns.rows.map((row) => [String(row.column_name), String(row.data_type)])
    )
    expect(byName.get("amount_cents")).toBe("integer")
    expect(byName.get("unit_count")).toBe("integer")
    expect([...byName.values()]).not.toEqual(
      expect.arrayContaining(["real", "double precision"])
    )
    expect(byName.has("amount_sats")).toBe(false)
  })

  it("lets webhook and return confirmation authorize one invoice", async () => {
    const invoiceId = "inv_race"
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const acquired = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_auth", sessionId: "payses_auth", ip: "203.0.113.8" })
      )
      expect(acquired.ok).toBe(true)
      if (acquired.ok) {
        await client.query(
          `UPDATE "btcpay_payment" SET "invoice_id" = $1, "status" = 'pending' WHERE "id" = $2`,
          [invoiceId, acquired.id]
        )
      }
      await client.query("COMMIT")
    } finally {
      client.release()
    }

    const results = await Promise.all([confirm(invoiceId), confirm(invoiceId)])
    expect(results.filter((result) => result === "claimed")).toHaveLength(1)
    expect(results.filter((result) => result === "replay")).toHaveLength(1)

    const claims = await pool.query(
      `SELECT count(*)::int AS count FROM "btcpay_invoice_claim" WHERE "invoice_id" = $1`,
      [invoiceId]
    )
    const payments = await pool.query(
      `SELECT "status" FROM "btcpay_payment" WHERE "invoice_id" = $1`,
      [invoiceId]
    )
    expect(claims.rows[0].count).toBe(1)
    expect(payments.rows).toHaveLength(1)
    expect(payments.rows[0].status).toBe("settled")
  })

  it("rejects a second open invoice for the same cart", async () => {
    const results = await Promise.all([
      acquireCommitted(acquireInput({ cartId: "cart_one", sessionId: "payses_a" })),
      acquireCommitted(acquireInput({ cartId: "cart_one", sessionId: "payses_b" })),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)

    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM "btcpay_payment" WHERE "cart_id" = 'cart_one'`
    )
    expect(rows.rows[0].count).toBe(1)

    const duplicate = await pool.query(
      `INSERT INTO "btcpay_payment" (
        "id", "provider", "status", "cart_id", "payment_session_hash", "unit_count",
        "amount_cents", "expires_at", "created_at", "updated_at"
      ) VALUES (
        'btpay_dup', 'btcpay', 'pending', 'cart_one', 'hash_dup', 1, 2500, now(), now(), now()
      )`
    ).then(
      () => "inserted",
      (error: { code?: string }) => error.code
    )
    expect(duplicate).toBe("23505")
  })

  it("holds the session advisory lock until the insert transaction commits", async () => {
    const clientA = await pool.connect()
    const clientB = await pool.connect()
    try {
      await clientA.query("BEGIN")
      const first = await acquirePaymentSlot(
        pgTx(clientA),
        acquireInput({ cartId: "cart_s1", sessionId: "payses_same" })
      )
      expect(first.ok).toBe(true)
      await clientB.query("BEGIN")
      const pid = await clientB.query(`SELECT pg_backend_pid() AS pid`)
      let secondDone = false
      const secondPromise = (async () => {
        const second = await acquirePaymentSlot(
          pgTx(clientB),
          acquireInput({ cartId: "cart_s2", sessionId: "payses_same" })
        )
        await clientB.query("COMMIT")
        secondDone = true
        return second
      })()
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(secondDone).toBe(false)
      const activity = await pool.query(
        `SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`,
        [pid.rows[0].pid]
      )
      expect(activity.rows[0]?.wait_event_type).toBe("Lock")
      expect(String(activity.rows[0]?.wait_event).toLowerCase()).toContain("advisory")
      await clientA.query("COMMIT")
      const second = await secondPromise
      expect(second.ok).toBe(false)
    } finally {
      await clientA.query("ROLLBACK").catch(() => undefined)
      await clientB.query("ROLLBACK").catch(() => undefined)
      clientA.release()
      clientB.release()
    }
  })

  it("stores HMAC hashes instead of the raw IP and session id", async () => {
    const rawSession = "payses_plain"
    const rawIp = "198.51.100.20"
    const result = await acquireCommitted(
      acquireInput({ cartId: "cart_hash", sessionId: rawSession, ip: rawIp })
    )
    expect(result.ok).toBe(true)
    const rows = await pool.query(
      `SELECT "payment_session_hash", "ip_hash", "amount_cents"
       FROM "btcpay_payment" WHERE "cart_id" = 'cart_hash'`
    )
    const row = rows.rows[0]
    expect(row.payment_session_hash).toBe(hashSessionId(rawSession, SECRET))
    expect(row.payment_session_hash).not.toBe(rawSession)
    expect(row.ip_hash).toBe(hashClientIp(rawIp, SECRET))
    expect(String(row.ip_hash)).not.toContain(rawIp)
    expect(row.amount_cents).toBe(2500)
  })

  it("nulls personal data on closed rows older than 30 days", async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    const recent = new Date()
    await pool.query(
      `INSERT INTO "btcpay_payment" (
        "id", "provider", "status", "cart_id", "payment_session_hash", "ip_hash",
        "unit_count", "amount_cents", "expires_at", "created_at", "updated_at"
      ) VALUES
        ('old_closed', 'btcpay', 'settled', 'cart_old', 'sess_old', 'ip_old', 1, 100, $1, $1, $1),
        ('new_closed', 'btcpay', 'settled', 'cart_new', 'sess_new', 'ip_new', 1, 100, $2, $2, $2),
        ('old_open', 'btcpay', 'pending', 'cart_open', 'sess_open', 'ip_open', 1, 100, $2, $1, $1)`,
      [old, recent]
    )
    await pool.query(
      `INSERT INTO "btcpay_invoice_claim" (
        "id", "invoice_id", "cart_id", "payment_session_hash", "amount_cents",
        "currency_code", "created_at", "updated_at"
      ) VALUES ('claim_old', 'inv_old', 'cart_old', 'sess_old', 100, 'usd', $1, $1)`,
      [old]
    )
    const client = await pool.connect()
    let count = 0
    try {
      await client.query("BEGIN")
      count = await redactClosedPersonalData(pgTx(client), new Date())
      await client.query("COMMIT")
    } finally {
      client.release()
    }
    expect(count).toBe(2)
    const payments = await pool.query(
      `SELECT "id", "ip_hash", "payment_session_hash" FROM "btcpay_payment" ORDER BY "id"`
    )
    const byId = new Map(payments.rows.map((row) => [String(row.id), row]))
    expect(byId.get("old_closed")?.ip_hash).toBeNull()
    expect(byId.get("old_closed")?.payment_session_hash).toBeNull()
    expect(byId.get("new_closed")?.ip_hash).toBe("ip_new")
    expect(byId.get("old_open")?.payment_session_hash).toBe("sess_open")
    const claim = await pool.query(
      `SELECT "payment_session_hash" FROM "btcpay_invoice_claim" WHERE "id" = 'claim_old'`
    )
    expect(claim.rows[0].payment_session_hash).toBeNull()
  })

  it("reverses the constraint migration and applies it again", async () => {
    try {
      await runAll(pool, migration170000Down)
      const downColumns = await pool.query(
        `SELECT "table_name", "column_name"
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name IN ('payment_session_id', 'payment_session_hash', 'amount_cents')`
      )
      const downNames = downColumns.rows.map(
        (row) => `${row.table_name}.${row.column_name}`
      )
      expect(downNames).toContain("btcpay_payment.payment_session_id")
      expect(downNames).toContain("btcpay_invoice_claim.payment_session_id")
      expect(downNames).not.toContain("btcpay_payment.payment_session_hash")
      expect(downNames).not.toContain("btcpay_payment.amount_cents")
      const downIndexes = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE indexname IN (
           'IDX_btcpay_payment_open_cart_unique',
           'IDX_btcpay_payment_provider_invoice_id_unique'
         )`
      )
      expect(downIndexes.rows).toHaveLength(0)

      await runAll(pool, migration170000Up)
      const upIndexes = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE indexname IN (
           'IDX_btcpay_payment_open_cart_unique',
           'IDX_btcpay_payment_provider_invoice_id_unique'
         )`
      )
      expect(upIndexes.rows).toHaveLength(2)
    } finally {
      await resetSchema()
    }
  })

  it("still drops the payment table from the earlier down migration", async () => {
    try {
      await runAll(pool, migration160000Down)
      const tables = await pool.query(
        `SELECT tablename FROM pg_tables WHERE tablename = 'btcpay_payment'`
      )
      expect(tables.rows).toHaveLength(0)
    } finally {
      await resetSchema()
    }
  })

  async function resetSchema() {
    await pool.query(`DROP TABLE IF EXISTS "btcpay_payment" CASCADE`)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_invoice_claim" CASCADE`)
    await runAll(pool, [
      ...migration143000Up,
      ...migration160000Up,
      ...migration170000Up,
    ])
  }

  async function acquireCommitted(input: ReturnType<typeof acquireInput>) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const result = await acquirePaymentSlot(pgTx(client), input)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async function confirm(invoiceId: string): Promise<"claimed" | "replay"> {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await confirmSettlement(pgTx(client), {
        id: newClaimId(),
        invoiceId,
        cartId: "cart_auth",
        paymentSessionHash: hashSessionId("payses_auth", SECRET),
        amountCents: 1000,
        currencyCode: "usd",
      })
      await client.query("COMMIT")
      return "claimed"
    } catch (error) {
      await client.query("ROLLBACK")
      if (isUniqueViolation(error)) {
        return "replay"
      }
      throw error
    } finally {
      client.release()
    }
  }
})
