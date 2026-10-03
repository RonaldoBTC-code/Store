const REGION_MAP_TTL_MS = 3600 * 1000

export type RegionCountry = {
  iso_2?: string | null
}

export type RegionWithCountries = {
  countries?: RegionCountry[] | null
}

export type RegionMapCache<T extends RegionWithCountries> = {
  map: Map<string, T>
  updatedAt: number
}

export type RegionFetchInit = {
  method: "GET"
  headers: Record<string, string>
  cache: "force-cache"
  next: { revalidate: number; tags: string[] }
}

export type RegionFetcher = (
  url: string,
  init: RegionFetchInit
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

async function defaultRegionFetcher(
  url: string,
  init: RegionFetchInit
): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  return fetch(url, init as RequestInit)
}

/**
 * Loads regions for middleware. A missing or unreachable backend returns the
 * last good map (possibly empty) instead of throwing.
 */
export async function loadRegionMap<T extends RegionWithCountries>(options: {
  backendUrl: string | undefined
  publishableKey: string | undefined
  cache: RegionMapCache<T>
  cacheId: string
  fetcher?: RegionFetcher
  now?: number
}): Promise<Map<string, T>> {
  const now = options.now ?? Date.now()
  const fresh =
    options.cache.map.size > 0 &&
    options.cache.updatedAt > now - REGION_MAP_TTL_MS

  if (fresh || !options.backendUrl) {
    return options.cache.map
  }

  try {
    const fetcher = options.fetcher ?? defaultRegionFetcher
    const response = await fetcher(`${options.backendUrl}/store/regions`, {
      method: "GET",
      headers: {
        "x-publishable-api-key": options.publishableKey ?? "",
      },
      next: {
        revalidate: 3600,
        tags: [`regions-${options.cacheId}`],
      },
      cache: "force-cache",
    })

    if (!response.ok) {
      return options.cache.map
    }

    const json = (await response.json()) as { regions?: T[] }
    const regions = json.regions

    if (!regions?.length) {
      return options.cache.map
    }

    options.cache.map.clear()

    for (const region of regions) {
      region.countries?.forEach((country) => {
        const iso = country.iso_2?.toLowerCase()
        if (iso) {
          options.cache.map.set(iso, region)
        }
      })
    }

    options.cache.updatedAt = now
    return options.cache.map
  } catch {
    return options.cache.map
  }
}

/**
 * Picks a country code from the request, then the default region.
 * An empty region map still resolves to `defaultRegion` so pages can render.
 */
export function pickCountryCode(input: {
  pathname: string
  regionMap: Map<string, unknown>
  cloudflareCountry?: string | null
  vercelCountry?: string | null
  defaultRegion: string
}): string {
  const urlCountryCode = input.pathname.split("/")[1]?.toLowerCase()
  const cloudflareCountry = input.cloudflareCountry?.toLowerCase()
  const vercelCountry = input.vercelCountry?.toLowerCase()

  if (urlCountryCode && input.regionMap.has(urlCountryCode)) {
    return urlCountryCode
  }

  if (cloudflareCountry && input.regionMap.has(cloudflareCountry)) {
    return cloudflareCountry
  }

  if (vercelCountry && input.regionMap.has(vercelCountry)) {
    return vercelCountry
  }

  if (input.regionMap.has(input.defaultRegion)) {
    return input.defaultRegion
  }

  const first = input.regionMap.keys().next().value
  return first || input.defaultRegion
}
