import {
  assertBtcpayTestDatabaseAllowed,
  btcpayTestDatabaseUrl,
} from "../test-database"

describe("BTCPay test database guard", () => {
  it("ignores DATABASE_URL and throws before a caller can drop tables", () => {
    const drop = jest.fn()

    expect(() => {
      const url = btcpayTestDatabaseUrl({
        DATABASE_URL: "postgresql://postgres:secret@localhost:5432/btcpay_test",
      } as NodeJS.ProcessEnv)
      drop(url)
    }).toThrow(/BTCPAY_TEST_DATABASE_URL/)

    expect(drop).not.toHaveBeenCalled()
  })

  it("refuses a non-local host, including postgres, before any drop", () => {
    const drop = jest.fn()

    expect(() => {
      const url = assertBtcpayTestDatabaseAllowed(
        "postgresql://btcpay_test:secret@postgres:5432/btcpay_test"
      )
      drop(url)
    }).toThrow(/host must be localhost/)

    expect(() =>
      assertBtcpayTestDatabaseAllowed(
        "postgresql://btcpay_test:secret@db.example:5432/btcpay_test"
      )
    ).toThrow(/host must be localhost/)
    expect(drop).not.toHaveBeenCalled()
  })

  it("refuses a database name other than btcpay_test", () => {
    expect(() =>
      assertBtcpayTestDatabaseAllowed(
        "postgresql://btcpay_test:secret@localhost:5432/medusa-dtc-starter"
      )
    ).toThrow(/database name must be btcpay_test/)
    expect(() =>
      assertBtcpayTestDatabaseAllowed("postgresql://postgres:secret@localhost:5432/postgres")
    ).toThrow(/database name must be btcpay_test/)
  })

  it("rewrites DB_HOST 127.0.0.1 to localhost and allows only btcpay_test", () => {
    const url = btcpayTestDatabaseUrl({
      BTCPAY_TEST_DATABASE_URL:
        "postgresql://btcpay_test:btcpay_test@127.0.0.1:5432/btcpay_test",
      DB_HOST: "127.0.0.1",
      DATABASE_URL: "postgresql://postgres:secret@postgres:5432/medusa",
    } as NodeJS.ProcessEnv)

    const parsed = new URL(url)
    expect(parsed.hostname).toBe("localhost")
    expect(parsed.pathname).toBe("/btcpay_test")
    expect(assertBtcpayTestDatabaseAllowed(url)).toBe(url)
  })

  it("allows a localhost URL whose database is btcpay_test", () => {
    const url = assertBtcpayTestDatabaseAllowed(
      "postgresql://btcpay_test:btcpay_test@localhost:5432/btcpay_test"
    )
    expect(new URL(url).hostname).toBe("localhost")
    expect(new URL(url).pathname).toBe("/btcpay_test")
  })
})
