import { describe, expect, it } from "vitest"
import {
  loadRegionMap,
  pickCountryCode,
  type RegionWithCountries,
} from "./request-region"

const region = (iso: string): RegionWithCountries => ({
  countries: [{ iso_2: iso }],
})

describe("loadRegionMap", () => {
  it("does not throw when the backend is missing or unreachable", async () => {
    const empty = { map: new Map<string, RegionWithCountries>(), updatedAt: 0 }

    await expect(
      loadRegionMap({
        backendUrl: undefined,
        publishableKey: undefined,
        cache: empty,
        cacheId: "cache",
      })
    ).resolves.toBe(empty.map)

    const stale = {
      map: new Map<string, RegionWithCountries>([["ec", region("ec")]]),
      updatedAt: 0,
    }

    const map = await loadRegionMap({
      backendUrl: "http://127.0.0.1:9",
      publishableKey: "pk",
      cache: stale,
      cacheId: "cache",
      fetcher: async () => {
        throw new Error("connect ECONNREFUSED")
      },
    })

    expect(map.has("ec")).toBe(true)
  })

  it("keeps the previous map when the backend responds with an error", async () => {
    const cache = {
      map: new Map<string, RegionWithCountries>([["ec", region("ec")]]),
      updatedAt: 0,
    }

    const map = await loadRegionMap({
      backendUrl: "http://backend.test",
      publishableKey: "pk",
      cache,
      cacheId: "cache",
      fetcher: async () => ({
        ok: false,
        json: async () => ({}),
      }),
    })

    expect(map.has("ec")).toBe(true)
    expect(cache.updatedAt).toBe(0)
  })

  it("replaces the map from a successful response", async () => {
    const cache = {
      map: new Map<string, RegionWithCountries>(),
      updatedAt: 0,
    }

    const map = await loadRegionMap({
      backendUrl: "http://backend.test",
      publishableKey: "pk",
      cache,
      cacheId: "abc",
      now: 1_000,
      fetcher: async (url, init) => {
        expect(url).toBe("http://backend.test/store/regions")
        expect(init.headers["x-publishable-api-key"]).toBe("pk")
        return {
          ok: true,
          json: async () => ({ regions: [region("EC")] }),
        }
      },
    })

    expect(map.has("ec")).toBe(true)
    expect(cache.updatedAt).toBe(1_000)
  })
})

describe("pickCountryCode", () => {
  it("falls back to ec when no regions could be loaded", () => {
    expect(
      pickCountryCode({
        pathname: "/store",
        regionMap: new Map(),
        defaultRegion: "ec",
      })
    ).toBe("ec")

    expect(
      pickCountryCode({
        pathname: "/ec/checkout",
        regionMap: new Map(),
        defaultRegion: "ec",
      })
    ).toBe("ec")
  })

  it("prefers a country that exists in the region map", () => {
    const regionMap = new Map<string, unknown>([
      ["ec", {}],
      ["us", {}],
    ])

    expect(
      pickCountryCode({
        pathname: "/us/products",
        regionMap,
        defaultRegion: "ec",
      })
    ).toBe("us")

    expect(
      pickCountryCode({
        pathname: "/checkout",
        regionMap,
        cloudflareCountry: "US",
        defaultRegion: "ec",
      })
    ).toBe("us")
  })

  it("uses the first known region when the default is absent", () => {
    expect(
      pickCountryCode({
        pathname: "/",
        regionMap: new Map<string, unknown>([["us", {}]]),
        defaultRegion: "ec",
      })
    ).toBe("us")
  })
})
