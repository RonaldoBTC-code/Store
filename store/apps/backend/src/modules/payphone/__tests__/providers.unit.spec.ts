import warnTestPaymentsLoader from "../../payphone-claim/loaders/warn-test-payments"
import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
  regionPaymentProviders,
  testPaymentsAllowed,
  warnTestPaymentsInProduction,
} from "../providers"

describe("Ecuador payment providers", () => {
  it("hides the manual provider in production", () => {
    const env = { NODE_ENV: "production" }

    expect(testPaymentsAllowed(env)).toBe(false)
    expect(regionPaymentProviders(env)).toEqual([PAYPHONE_PROVIDER_ID])
  })

  it("keeps the manual provider when ALLOW_TEST_PAYMENTS is true", () => {
    const env = { NODE_ENV: "production", ALLOW_TEST_PAYMENTS: "true" }

    expect(regionPaymentProviders(env)).toEqual([
      PAYPHONE_PROVIDER_ID,
      SYSTEM_PROVIDER_ID,
    ])
  })

  it("keeps the manual provider for dev and CI end-to-end", () => {
    expect(regionPaymentProviders({ NODE_ENV: "development" })).toEqual([
      PAYPHONE_PROVIDER_ID,
      SYSTEM_PROVIDER_ID,
    ])
    expect(regionPaymentProviders({ NODE_ENV: "test" })).toEqual([
      PAYPHONE_PROVIDER_ID,
      SYSTEM_PROVIDER_ID,
    ])
  })

  it("stays quiet when production does not force test payments", () => {
    const warn = jest.fn()

    warnTestPaymentsInProduction({ warn }, { NODE_ENV: "production" })
    warnTestPaymentsInProduction(
      { warn },
      { NODE_ENV: "development", ALLOW_TEST_PAYMENTS: "true" }
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it("throws from the real loader when production forces test payments", async () => {
    const warn = jest.fn()

    await withProcessEnv(
      { NODE_ENV: "production", ALLOW_TEST_PAYMENTS: "true" },
      async () => {
        expect(regionPaymentProviders()).toEqual([
          PAYPHONE_PROVIDER_ID,
          SYSTEM_PROVIDER_ID,
        ])
        await expect(
          warnTestPaymentsLoader({ logger: { warn } })
        ).rejects.toThrow(/ALLOW_TEST_PAYMENTS/)
      }
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it("starts through the real loader when production hides the manual provider", async () => {
    const warn = jest.fn()

    await withProcessEnv({ NODE_ENV: "production" }, async () => {
      expect(regionPaymentProviders()).toEqual([PAYPHONE_PROVIDER_ID])
      await expect(
        warnTestPaymentsLoader({ logger: { warn } })
      ).resolves.toBeUndefined()
    })

    expect(warn).not.toHaveBeenCalled()
  })

  it("honors ALLOW_TEST_PAYMENTS=false outside production", () => {
    expect(
      regionPaymentProviders({
        NODE_ENV: "development",
        ALLOW_TEST_PAYMENTS: "false",
      })
    ).toEqual([PAYPHONE_PROVIDER_ID])
  })
})

async function withProcessEnv(
  env: { NODE_ENV?: string; ALLOW_TEST_PAYMENTS?: string },
  run: () => Promise<void>
) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_TEST_PAYMENTS: process.env.ALLOW_TEST_PAYMENTS,
  }

  assignEnv(env)

  try {
    await run()
  } finally {
    assignEnv(previous)
  }
}

function assignEnv(env: { NODE_ENV?: string; ALLOW_TEST_PAYMENTS?: string }) {
  if (env.NODE_ENV === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = env.NODE_ENV
  }

  if (env.ALLOW_TEST_PAYMENTS === undefined) {
    delete process.env.ALLOW_TEST_PAYMENTS
  } else {
    process.env.ALLOW_TEST_PAYMENTS = env.ALLOW_TEST_PAYMENTS
  }
}
