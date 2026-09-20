"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

export const listRegions = async () => {
  const next = {
    ...(await getCacheOptions("regions")),
  }

  return await sdk.client
    .fetch<{ regions: HttpTypes.StoreRegion[] }>(`/store/regions`, {
      method: "GET",
      next,
      cache: "force-cache",
    })
    .then(({ regions }) => regions)
    .catch(() => [])
}

export const retrieveRegion = async (id: string) => {
  const next = {
    ...(await getCacheOptions(["regions", id].join("-"))),
  }

  return await sdk.client
    .fetch<{ region: HttpTypes.StoreRegion }>(`/store/regions/${id}`, {
      method: "GET",
      next,
      cache: "force-cache",
    })
    .then(({ region }) => region)
}

/**
 * Resolves a store region from a country code without a process-wide stale map.
 */
export const getRegion = async (countryCode: string) => {
  if (!countryCode) {
    return null
  }

  const regions = await listRegions()

  if (!regions?.length) {
    return null
  }

  const regionMap = new Map<string, HttpTypes.StoreRegion>()

  regions.forEach((region) => {
    region.countries?.forEach((country) => {
      const iso = country?.iso_2
      if (iso) {
        regionMap.set(iso, region)
      }
    })
  })

  return regionMap.get(countryCode) ?? null
}
