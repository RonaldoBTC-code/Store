import { isUniqueViolation } from "../../src/modules/btcpay/claim"
import { hashClientIp, hashSessionId } from "../../src/modules/btcpay/limits"
import {
  acquirePaymentSlot,
  closeOpenPayment,
  commitOpenInvoice,
  confirmSettlement,
  newClaimId,
  PaymentNotOpenError,
  pgTx,
  redactClosedPersonalData,
} from "../../src/modules/btcpay/payment-sql"
import {
  btcpayMigrationDown,
  btcpayMigrationUp,
} from "../../src/modules/btcpay-claim/migrations/sql"
import { btcpayTestDatabaseUrl } from "../../src/modules/btcpay/test-database"

const SECRET = "server-secret"

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

async function waitForAdvisoryLock(
  pool: PgPool,
  pid: number,
  finished: () => boolean
): Promise<{ wait_event_type: string; wait_event: string }> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (finished()) {
      throw new Error("second acquire finished before the advisory lock was observed")
    }
    const activity = await pool.query(
      `SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`,
      [pid]
    )
    const row = activity.rows[0]
    const event = String(row?.wait_event ?? "").toLowerCase()
    if (row?.wait_event_type === "Lock" && event.includes("advisory")) {
      return { wait_event_type: String(row.wait_event_type), wait_event: event }
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("timed out waiting for the advisory lock in pg_stat_activity")
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
    const connectionString = btcpayTestDatabaseUrl()
    pool = createPool(connectionString)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_payment" CASCADE`)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_invoice_claim" CASCADE`)
    await runAll(pool, btcpayMigrationUp)
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
    let secondDone = false
    let secondPromise: Promise<{ ok: boolean }> = Promise.resolve({ ok: true })
    try {
      await clientA.query("BEGIN")
      const first = await acquirePaymentSlot(
        pgTx(clientA),
        acquireInput({ cartId: "cart_s1", sessionId: "payses_same" })
      )
      expect(first.ok).toBe(true)
      await clientB.query("BEGIN")
      const pid = await clientB.query(`SELECT pg_backend_pid() AS pid`)
      secondPromise = (async () => {
        const second = await acquirePaymentSlot(
          pgTx(clientB),
          acquireInput({ cartId: "cart_s2", sessionId: "payses_same" })
        )
        await clientB.query("COMMIT")
        secondDone = true
        return second
      })()
      const activity = await waitForAdvisoryLock(pool, Number(pid.rows[0].pid), () => secondDone)
      expect(secondDone).toBe(false)
      expect(activity.wait_event_type).toBe("Lock")
      expect(activity.wait_event).toContain("advisory")
      await clientA.query("COMMIT")
      const second = await secondPromise
      expect(second.ok).toBe(false)
    } finally {
      await clientA.query("ROLLBACK").catch(() => undefined)
      await clientB.query("ROLLBACK").catch(() => undefined)
      await secondPromise.catch(() => undefined)
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

  it("returns the reservations an open invoice had before close", async () => {
    const invoiceId = "inv_open_close"
    const client = await pool.connect()
    let released: string[] = []
    try {
      await client.query("BEGIN")
      const acquired = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_open_close", sessionId: "payses_open_close" })
      )
      expect(acquired.ok).toBe(true)
      if (!acquired.ok) {
        return
      }
      const stored = await commitOpenInvoice(pgTx(client), {
        id: acquired.id,
        invoiceId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        reservationIds: ["res_a", "res_b"],
      })
      expect(stored).toBe(true)
      released = await closeOpenPayment(pgTx(client), invoiceId, "expired")
      await client.query("COMMIT")
    } finally {
      client.release()
    }

    expect(released).toEqual(["res_a", "res_b"])
    const row = await pool.query(
      `SELECT "status", "reservation_ids" FROM "btcpay_payment" WHERE "invoice_id" = $1`,
      [invoiceId]
    )
    expect(row.rows[0].status).toBe("expired")
    expect(row.rows[0].reservation_ids).toEqual({ ids: [] })
  })

  it("keeps a settled payment settled when a later expired close arrives", async () => {
    const invoiceId = "inv_late_expired"
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const acquired = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_late", sessionId: "payses_late" })
      )
      expect(acquired.ok).toBe(true)
      if (!acquired.ok) {
        return
      }
      const stored = await commitOpenInvoice(pgTx(client), {
        id: acquired.id,
        invoiceId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        reservationIds: ["res_keep"],
      })
      expect(stored).toBe(true)
      await confirmSettlement(pgTx(client), {
        id: newClaimId(),
        invoiceId,
        cartId: "cart_late",
        paymentSessionHash: hashSessionId("payses_late", SECRET),
        amountCents: 2500,
        currencyCode: "usd",
      })
      await client.query(
        `UPDATE "btcpay_payment"
         SET "reservation_ids" = '{"ids":["res_keep"]}'::jsonb
         WHERE "invoice_id" = $1`,
        [invoiceId]
      )
      await client.query("COMMIT")
    } finally {
      client.release()
    }

    const closed = await pool.connect()
    try {
      await closed.query("BEGIN")
      const released = await closeOpenPayment(pgTx(closed), invoiceId, "expired")
      await closed.query("COMMIT")
      expect(released).toEqual([])
    } finally {
      closed.release()
    }

    const row = await pool.query(
      `SELECT "status", "reservation_ids"
       FROM "btcpay_payment"
       WHERE "invoice_id" = $1`,
      [invoiceId]
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].status).toBe("settled")
    expect(row.rows[0].reservation_ids).toEqual({ ids: ["res_keep"] })
    const counts = await pool.query(
      `SELECT
         count(*) FILTER (WHERE "status" = 'settled')::int AS settled,
         count(*) FILTER (WHERE "status" = 'expired')::int AS expired
       FROM "btcpay_payment"
       WHERE "invoice_id" = $1`,
      [invoiceId]
    )
    expect(counts.rows[0].settled).toBe(1)
    expect(counts.rows[0].expired).toBe(0)
  })

  it("does not revive a holding row that is no longer holding", async () => {
    const client = await pool.connect()
    let holdingId = ""
    try {
      await client.query("BEGIN")
      const acquired = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_gone", sessionId: "payses_gone" })
      )
      expect(acquired.ok).toBe(true)
      if (!acquired.ok) {
        return
      }
      holdingId = acquired.id
      await client.query(
        `UPDATE "btcpay_payment" SET "status" = 'expired' WHERE "id" = $1`,
        [holdingId]
      )
      const stored = await commitOpenInvoice(pgTx(client), {
        id: holdingId,
        invoiceId: "inv_too_late",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        reservationIds: ["res_late"],
      })
      expect(stored).toBe(false)
      await client.query("COMMIT")
    } finally {
      client.release()
    }

    const row = await pool.query(
      `SELECT "status", "invoice_id" FROM "btcpay_payment" WHERE "id" = $1`,
      [holdingId]
    )
    expect(row.rows[0].status).toBe("expired")
    expect(row.rows[0].invoice_id).toBeNull()
    const revived = await pool.query(
      `SELECT count(*)::int AS count FROM "btcpay_payment" WHERE "invoice_id" = 'inv_too_late'`
    )
    expect(revived.rows[0].count).toBe(0)
  })

  it("counts rows changed by close, commit, and confirm", async () => {
    const invoiceId = "inv_counts"
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const acquired = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_counts", sessionId: "payses_counts" })
      )
      expect(acquired.ok).toBe(true)
      if (!acquired.ok) {
        return
      }
      const stored = await commitOpenInvoice(pgTx(client), {
        id: acquired.id,
        invoiceId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        reservationIds: ["res_count"],
      })
      expect(stored).toBe(true)
      const pending = await client.query(
        `SELECT count(*)::int AS count
         FROM "btcpay_payment"
         WHERE "id" = $1 AND "status" = 'pending' AND "invoice_id" = $2`,
        [acquired.id, invoiceId]
      )
      expect(pending.rows[0].count).toBe(1)

      const again = await commitOpenInvoice(pgTx(client), {
        id: acquired.id,
        invoiceId: "inv_counts_again",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        reservationIds: ["res_again"],
      })
      expect(again).toBe(false)
      const notRewritten = await client.query(
        `SELECT count(*)::int AS count FROM "btcpay_payment" WHERE "invoice_id" = 'inv_counts_again'`
      )
      expect(notRewritten.rows[0].count).toBe(0)

      await confirmSettlement(pgTx(client), {
        id: newClaimId(),
        invoiceId,
        cartId: "cart_counts",
        paymentSessionHash: hashSessionId("payses_counts", SECRET),
        amountCents: 2500,
        currencyCode: "usd",
      })
      const confirmed = await client.query(
        `SELECT
           (SELECT count(*)::int FROM "btcpay_payment" WHERE "invoice_id" = $1 AND "status" = 'settled') AS payments,
           (SELECT count(*)::int FROM "btcpay_invoice_claim" WHERE "invoice_id" = $1) AS claims`,
        [invoiceId]
      )
      expect(confirmed.rows[0].payments).toBe(1)
      expect(confirmed.rows[0].claims).toBe(1)

      await expect(
        confirmSettlement(pgTx(client), {
          id: newClaimId(),
          invoiceId,
          cartId: "cart_counts",
          paymentSessionHash: hashSessionId("payses_counts", SECRET),
          amountCents: 2500,
          currencyCode: "usd",
        })
      ).rejects.toBeInstanceOf(PaymentNotOpenError)
      const claimsAfter = await client.query(
        `SELECT count(*)::int AS count FROM "btcpay_invoice_claim" WHERE "invoice_id" = $1`,
        [invoiceId]
      )
      expect(claimsAfter.rows[0].count).toBe(1)

      const released = await closeOpenPayment(pgTx(client), invoiceId, "expired")
      expect(released).toEqual([])
      const stillSettled = await client.query(
        `SELECT
           count(*) FILTER (WHERE "status" = 'settled')::int AS settled,
           count(*) FILTER (WHERE "status" = 'expired')::int AS expired
         FROM "btcpay_payment"
         WHERE "invoice_id" = $1`,
        [invoiceId]
      )
      expect(stillSettled.rows[0].settled).toBe(1)
      expect(stillSettled.rows[0].expired).toBe(0)

      const openInvoice = "inv_counts_open"
      const open = await acquirePaymentSlot(
        pgTx(client),
        acquireInput({ cartId: "cart_counts_open", sessionId: "payses_counts_open" })
      )
      expect(open.ok).toBe(true)
      if (!open.ok) {
        return
      }
      expect(
        await commitOpenInvoice(pgTx(client), {
          id: open.id,
          invoiceId: openInvoice,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          reservationIds: ["res_open"],
        })
      ).toBe(true)
      expect(await closeOpenPayment(pgTx(client), openInvoice, "expired")).toEqual(["res_open"])
      const closed = await client.query(
        `SELECT count(*)::int AS count
         FROM "btcpay_payment"
         WHERE "invoice_id" = $1 AND "status" = 'expired'`,
        [openInvoice]
      )
      expect(closed.rows[0].count).toBe(1)
      await client.query("COMMIT")
    } finally {
      await client.query("ROLLBACK").catch(() => undefined)
      client.release()
    }
  })

  it("drops both tables on down and recreates the final schema", async () => {
    try {
      await runAll(pool, btcpayMigrationDown)
      const tables = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE tablename IN ('btcpay_payment', 'btcpay_invoice_claim')`
      )
      expect(tables.rows).toHaveLength(0)

      await runAll(pool, btcpayMigrationUp)
      const columns = await pool.query(
        `SELECT "table_name", "column_name"
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name IN ('payment_session_id', 'payment_session_hash', 'amount_cents')`
      )
      const names = columns.rows.map((row) => `${row.table_name}.${row.column_name}`)
      expect(names).toContain("btcpay_payment.payment_session_hash")
      expect(names).toContain("btcpay_invoice_claim.payment_session_hash")
      expect(names).toContain("btcpay_payment.amount_cents")
      expect(names).not.toContain("btcpay_payment.payment_session_id")
      const indexes = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE indexname IN (
           'IDX_btcpay_payment_open_cart_unique',
           'IDX_btcpay_payment_provider_invoice_id_unique'
         )`
      )
      expect(indexes.rows).toHaveLength(2)
    } finally {
      await resetSchema()
    }
  })

  async function resetSchema() {
    await pool.query(`DROP TABLE IF EXISTS "btcpay_payment" CASCADE`)
    await pool.query(`DROP TABLE IF EXISTS "btcpay_invoice_claim" CASCADE`)
    await runAll(pool, btcpayMigrationUp)
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
      if (isUniqueViolation(error) || error instanceof PaymentNotOpenError) {
        return "replay"
      }
      throw error
    } finally {
      client.release()
    }
  }
})
