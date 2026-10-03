type ZoneCleanupEnv = {
  FIX_EC_ZONES?: string
}

export type GeoZoneShape = {
  type?: string | null
  country_code?: string | null
  province_code?: string | null
  city?: string | null
  postal_expression?: unknown
}

/**
 * Misplaced Ecuador country zones are logged and left in place unless
 * FIX_EC_ZONES=true.
 */
export function shouldDeleteMisplacedEcuadorZones(
  env: ZoneCleanupEnv = process.env
) {
  return env.FIX_EC_ZONES === "true"
}

/**
 * Country-level Ecuador only. A province, city, or postal zone that happens
 * to use country code ec is not a candidate for deletion.
 */
export function isCountryLevelEcuadorZone(zone: {
  geo_zones?: GeoZoneShape[] | null
}) {
  const geoZones = zone.geo_zones ?? []
  if (geoZones.length !== 1) {
    return false
  }

  const geoZone = geoZones[0]
  if ((geoZone.type ?? "").toLowerCase() !== "country") {
    return false
  }
  if (geoZone.province_code || geoZone.city || hasPostalConstraint(geoZone.postal_expression)) {
    return false
  }

  return (geoZone.country_code ?? "").toLowerCase() === "ec"
}

function hasPostalConstraint(value: unknown) {
  if (value == null || value === "") {
    return false
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value).length > 0
  }
  return true
}

export function ecuadorReplacementIsReady(input: {
  hasCountryZone: boolean
  shippingOptionIds: string[]
}) {
  return input.hasCountryZone && input.shippingOptionIds.length > 0
}
