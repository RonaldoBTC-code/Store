type ZoneCleanupEnv = {
  FIX_EC_ZONES?: string
}

/**
 * Misplaced Ecuador-only zones are logged and left in place unless
 * FIX_EC_ZONES=true.
 */
export function shouldDeleteMisplacedEcuadorZones(
  env: ZoneCleanupEnv = process.env
) {
  return env.FIX_EC_ZONES === "true"
}
