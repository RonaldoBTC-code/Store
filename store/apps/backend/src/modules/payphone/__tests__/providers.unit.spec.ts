import {
  PAYPHONE_PROVIDER_ID,
  SYSTEM_PROVIDER_ID,
  assertManualProviderAllowedAtStartup,
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

  it("warns on every check when test payments are forced in production", () => {
    const warn = jest.fn()

    warnTestPaymentsInProduction(
      { warn },
      { NODE_ENV: "production", ALLOW_TEST_PAYMENTS: "true" }
    )
    warnTestPaymentsInProduction(
      { warn },
      { NODE_ENV: "production", ALLOW_TEST_PAYMENTS: "true" }
    )

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toMatch(/never for production/i)
    expect(warn.mock.calls[0][0]).not.toMatch(/PAYPHONE_TOKEN|Bearer/)
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

  it("fails startup when pp_system_default is on in production without ALLOW_TEST_PAYMENTS", () => {
    expect(() =>
      assertManualProviderAllowedAtStartup(
        [PAYPHONE_PROVIDER_ID, SYSTEM_PROVIDER_ID],
        { NODE_ENV: "production" }
      )
    ).toThrow(/pp_system_default/)
  })

  it("refuses to start when ALLOW_TEST_PAYMENTS is true in production", () => {
    expect(() =>
      assertManualProviderAllowedAtStartup([PAYPHONE_PROVIDER_ID], {
        NODE_ENV: "production",
        ALLOW_TEST_PAYMENTS: "true",
      })
    ).toThrow(/ALLOW_TEST_PAYMENTS/)
  })

  it("starts in production when the manual provider is not enabled", () => {
    expect(() =>
      assertManualProviderAllowedAtStartup([PAYPHONE_PROVIDER_ID], {
        NODE_ENV: "production",
      })
    ).not.toThrow()
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
