import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
  regionPaymentProviders,
  testPaymentsAllowed,
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

  it("includes the manual provider outside production", () => {
    expect(regionPaymentProviders({ NODE_ENV: "development" })).toEqual([
      PAYPHONE_PROVIDER_ID,
      SYSTEM_PROVIDER_ID,
    ])
    expect(regionPaymentProviders({ NODE_ENV: "test" })).toContain(
      SYSTEM_PROVIDER_ID
    )
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
