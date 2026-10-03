import {
  chooseShippingFulfillmentSet,
  namedStockLocation,
  paymentProvidersForRegion,
  planIva,
  planRegionCountries,
  planStoreCurrencies,
  SYSTEM_PAYMENT_PROVIDER_ID,
} from "../ecuador-store-policy"

describe("paymentProvidersForRegion", () => {
  it("adds pp_system_default only when the region has no provider", () => {
    expect(paymentProvidersForRegion([])).toEqual([SYSTEM_PAYMENT_PROVIDER_ID])
  })

  it("does not re-add pp_system_default once any provider is configured", () => {
    expect(paymentProvidersForRegion(["pp_payphone"])).toBeNull()
    expect(
      paymentProvidersForRegion([SYSTEM_PAYMENT_PROVIDER_ID, "pp_payphone"])
    ).toBeNull()
    expect(paymentProvidersForRegion([SYSTEM_PAYMENT_PROVIDER_ID])).toBeNull()
  })
})

describe("planStoreCurrencies", () => {
  it("leaves currencies that are already set", () => {
    expect(
      planStoreCurrencies([
        { currency_code: "eur", is_default: true },
        { currency_code: "usd", is_default: false },
      ])
    ).toEqual({ action: "leave" })
  })

  it("adds USD without taking the existing default", () => {
    expect(
      planStoreCurrencies([{ currency_code: "eur", is_default: true }])
    ).toEqual({
      action: "add-usd",
      currencies: [
        { currency_code: "eur", is_default: true },
        { currency_code: "usd", is_default: false },
      ],
    })
  })

  it("sets USD as the default only when the store has no currencies", () => {
    expect(planStoreCurrencies([])).toEqual({ action: "set-default-usd" })
  })
})

describe("planIva", () => {
  it("does not replace a default tax rate that is already set", () => {
    expect(
      planIva([{ id: "txr_1", code: "VAT", rate: 20, is_default: true }])
    ).toEqual({ action: "add", isDefault: false })
    expect(
      planIva([{ id: "txr_1", code: "IVA", rate: 15, is_default: true }])
    ).toEqual({ action: "noop", reason: "default tax rate IVA" })
  })

  it("adds IVA as the default only when the tax region has no rates", () => {
    expect(planIva([])).toEqual({ action: "add", isDefault: true })
  })

  it("warns when the existing default IVA rate is not 15%", () => {
    expect(
      planIva([{ id: "txr_1", code: "IVA", rate: 12, is_default: true }])
    ).toEqual({
      action: "add",
      isDefault: false,
      warning: "Default IVA rate is 12%, not 15%. Leaving that default unchanged.",
    })
  })
})

describe("planRegionCountries", () => {
  it("adds ec when the reused region has no countries", () => {
    expect(
      planRegionCountries({
        regionId: "reg_ec",
        regionName: "Ecuador",
        countryCodes: [],
        otherRegions: [],
      })
    ).toEqual({ action: "add", countries: ["ec"] })
  })

  it("keeps a region that already includes ec without rewriting its countries", () => {
    expect(
      planRegionCountries({
        regionId: "reg_ec",
        regionName: "Europe",
        countryCodes: ["ec", "co"],
        otherRegions: [],
      })
    ).toEqual({ action: "keep" })
  })

  it("stops when ec is already attached to another region", () => {
    const plan = planRegionCountries({
      regionId: "reg_named",
      regionName: "Ecuador",
      countryCodes: [],
      otherRegions: [{ id: "reg_other", name: "Andes", countryCodes: ["ec"] }],
    })

    expect(plan.action).toBe("stop")
    if (plan.action === "stop") {
      expect(plan.message).toContain("reg_other")
      expect(plan.message).toContain("Refusing to attach")
    }
  })
})

describe("chooseShippingFulfillmentSet", () => {
  it("uses the shipping set and never a pickup set", () => {
    const pickup = { id: "fset_pickup", name: "Recojo", type: "pickup" }
    const shipping = { id: "fset_ship", name: "Other", type: "shipping" }
    const named = { id: "fset_ec", name: "Envíos Ecuador", type: "shipping" }

    expect(chooseShippingFulfillmentSet([pickup])).toBeNull()
    expect(chooseShippingFulfillmentSet([pickup, shipping])).toEqual(shipping)
    expect(chooseShippingFulfillmentSet([pickup, shipping, named])).toEqual(named)
    expect(
      chooseShippingFulfillmentSet([
        { id: "fset_named_pickup", name: "Envíos Ecuador", type: "pickup" },
      ])
    ).toBeNull()
  })
})

describe("namedStockLocation", () => {
  it("uses the location named Ecuador and ignores another ec address", () => {
    const quito = { id: "sloc_quito", name: "Quito", country: "ec" }
    const ecuador = { id: "sloc_ec", name: "Ecuador", country: "ec" }

    expect(namedStockLocation([quito, ecuador])).toEqual(ecuador)
    expect(namedStockLocation([quito])).toBeNull()
  })
})
