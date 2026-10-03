/**
 * NODE_ENV de producción: se recorta, se pasa a minúsculas y vale
 * `production` o `prod`.
 *
 * El PR de seeds tiene otra copia de esta normalización. Después de
 * mergear los dos, el seed debe usar este helper.
 */

const PRODUCTION_VALUES = new Set(["production", "prod"])

export function isProductionEnv(nodeEnv: string | undefined): boolean {
  if (!nodeEnv?.trim()) {
    return false
  }

  return PRODUCTION_VALUES.has(nodeEnv.trim().toLowerCase())
}
