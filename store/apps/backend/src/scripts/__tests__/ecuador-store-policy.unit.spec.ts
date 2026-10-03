import {
  chooseShippingFulfillmentSet,
  defaultShippingProfileNameConflict,
  ecuadorShippingProfileWarning,
  matchDefaultShippingProfiles,
  matchExactName,
  namedStockLocation,
  paymentProvidersForRegion,
  planIva,
  planRegionCountries,
  planStoreCurrencies,
  productionFixFlagWarning,
  reusedRegionCurrencyWarning,
  shouldFixEcuadorShippingProfile,
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

describe("matchExactName", () => {
  it("fails when more than one sales channel has the exact name", () => {
    const match = matchExactName(
      [
        { id: "sc_1", name: "Default Sales Channel" },
        { id: "sc_other", name: "Wholesale" },
        { id: "sc_2", name: "Default Sales Channel" },
      ],
      "Default Sales Channel",
      "sales channel"
    )

    expect(match.status).toBe("duplicate")
    if (match.status === "duplicate") {
      expect(match.message).toContain("sc_1")
      expect(match.message).toContain("sc_2")
      expect(match.message).toContain("Refusing to pick one")
    }
  })

  it("returns the single exact match and ignores a different name", () => {
    expect(
      matchExactName(
        [
          { id: "sc_other", name: "Default Sales Channel extra" },
          { id: "sc_1", name: "Default Sales Channel" },
        ],
        "Default Sales Channel",
        "sales channel"
      )
    ).toEqual({
      status: "one",
      record: { id: "sc_1", name: "Default Sales Channel" },
    })
    expect(matchExactName([], "Default Sales Channel").status).toBe("missing")
  })
})

describe("matchDefaultShippingProfiles", () => {
  it("uses type default and fails when more than one default exists", () => {
    const custom = { id: "sp_custom", type: "custom" }
    const fallback = { id: "sp_first", type: "gift" }
    const standard = { id: "sp_default", type: "default" }
    const second = { id: "sp_default_2", type: "default" }

    expect(matchDefaultShippingProfiles([custom, fallback])).toEqual({
      status: "missing",
    })
    expect(matchDefaultShippingProfiles([custom, standard])).toEqual({
      status: "one",
      profile: standard,
    })
    expect(matchDefaultShippingProfiles([])).toEqual({ status: "missing" })

    const duplicate = matchDefaultShippingProfiles([standard, custom, second])
    expect(duplicate.status).toBe("duplicate")
    if (duplicate.status === "duplicate") {
      expect(duplicate.message).toContain("sp_default")
      expect(duplicate.message).toContain("sp_default_2")
      expect(duplicate.message).toContain("Refusing to pick one")
    }
  })
})

describe("defaultShippingProfileNameConflict", () => {
  it("stops when the default name already belongs to another type", () => {
    const message = defaultShippingProfileNameConflict([
      { id: "sp_gift", name: "Default Shipping Profile", type: "gift" },
    ])

    expect(message).toContain("sp_gift")
    expect(message).toContain('type "gift"')
    expect(message).toContain("not \"default\"")
    expect(message).toContain("Refusing to create")
    expect(
      defaultShippingProfileNameConflict([
        { id: "sp_default", name: "Default Shipping Profile", type: "default" },
      ])
    ).toBeUndefined()
    expect(
      defaultShippingProfileNameConflict([
        { id: "sp_other", name: "Gifts", type: "gift" },
      ])
    ).toBeUndefined()
  })
})

describe("ecuadorShippingProfileWarning", () => {
  it("warns unless the option already uses the default profile", () => {
    const warning = ecuadorShippingProfileWarning({
      optionName: "Envío estándar",
      optionId: "so_1",
      optionProfileId: "sp_custom",
      defaultProfileId: "sp_default",
    })

    expect(warning).toContain("Envío estándar")
    expect(warning).toContain("sp_custom")
    expect(warning).toContain("sp_default")
    expect(warning).toContain("FIX_EC_SHIPPING_PROFILE=true")
    expect(warning).toContain("left unchanged")
    expect(
      ecuadorShippingProfileWarning({
        optionName: "Envío estándar",
        optionId: "so_1",
        optionProfileId: "sp_default",
        defaultProfileId: "sp_default",
      })
    ).toBeUndefined()
  })

  it("warns whenever setup runs in production with a one-time fix flag", () => {
    const zones = productionFixFlagWarning({
      NODE_ENV: "production",
      FIX_EC_ZONES: "true",
    })
    const profile = productionFixFlagWarning({
      NODE_ENV: " prod ",
      FIX_EC_SHIPPING_PROFILE: "true",
    })
    const both = productionFixFlagWarning({
      NODE_ENV: "Production",
      FIX_EC_ZONES: "true",
      FIX_EC_SHIPPING_PROFILE: "true",
    })

    expect(zones).toContain("FIX_EC_ZONES")
    expect(zones).toContain("one-time flags")
    expect(zones).toContain("must be removed")
    expect(profile).toContain("FIX_EC_SHIPPING_PROFILE")
    expect(profile).toContain("pnpm seed:ec")
    expect(profile).toContain("first migrate of a fresh database")
    expect(profile).not.toContain("every deploy")
    expect(both).toContain("FIX_EC_ZONES and FIX_EC_SHIPPING_PROFILE")
    expect(
      productionFixFlagWarning({
        NODE_ENV: "development",
        FIX_EC_ZONES: "true",
        FIX_EC_SHIPPING_PROFILE: "true",
      })
    ).toBeUndefined()
    expect(
      productionFixFlagWarning({
        NODE_ENV: "production",
        FIX_EC_ZONES: "1",
        FIX_EC_SHIPPING_PROFILE: "false",
      })
    ).toBeUndefined()
    expect(productionFixFlagWarning({ NODE_ENV: "staging" })).toBeUndefined()
  })

  it("moves the option only when FIX_EC_SHIPPING_PROFILE=true", () => {
    expect(shouldFixEcuadorShippingProfile({})).toBe(false)
    expect(shouldFixEcuadorShippingProfile({ FIX_EC_SHIPPING_PROFILE: "1" })).toBe(
      false
    )
    expect(
      shouldFixEcuadorShippingProfile({ FIX_EC_SHIPPING_PROFILE: "true" })
    ).toBe(true)
  })
})

describe("reusedRegionCurrencyWarning", () => {
  it("warns when a region that already includes ec is not USD", () => {
    const warning = reusedRegionCurrencyWarning({
      countryCodes: ["ec", "co"],
      currencyCode: "eur",
      regionName: "Andes",
      regionId: "reg_andes",
    })

    expect(warning).toContain("reg_andes")
    expect(warning).toContain("eur")
    expect(warning).toContain("not usd")
    expect(warning).toContain("without changing the currency")
  })

  it("stays quiet when the region is already USD or does not include ec", () => {
    expect(
      reusedRegionCurrencyWarning({
        countryCodes: ["ec"],
        currencyCode: "USD",
        regionName: "Ecuador",
        regionId: "reg_ec",
      })
    ).toBeUndefined()
    expect(
      reusedRegionCurrencyWarning({
        countryCodes: [],
        currencyCode: "eur",
        regionName: "Ecuador",
        regionId: "reg_named",
      })
    ).toBeUndefined()
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
