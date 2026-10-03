import { MedusaError } from "@medusajs/framework/utils"

/**
 * USD comparison uses integer cents so 10.10 and 10.1 cannot drift apart
 * through binary floating point. More than two decimal places is rejected.
 */
export function majorToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null
    }
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents)) {
      return null
    }
    if (Math.abs(cents / 100 - value) > 1e-6) {
      return null
    }
    return cents
  }

  if (typeof value === "string") {
    return decimalStringToCents(value.trim())
  }

  if (value && typeof value === "object") {
    const record = value as { value?: unknown; numeric?: unknown; raw?: unknown }
    if (typeof record.value === "string" || typeof record.value === "number") {
      return majorToCents(record.value)
    }
    if (record.raw && typeof record.raw === "object") {
      const raw = record.raw as { value?: unknown }
      if (typeof raw.value === "string" || typeof raw.value === "number") {
        return majorToCents(raw.value)
      }
    }
    if (typeof record.numeric === "number") {
      return majorToCents(record.numeric)
    }
  }

  return null
}

export function decimalStringToCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) {
    return null
  }
  const whole = Number(match[1])
  const fraction = match[2] ?? ""
  if (fraction.length > 2) {
    return null
  }
  const cents = whole * 100 + Number(fraction.padEnd(2, "0"))
  if (!Number.isSafeInteger(cents)) {
    return null
  }
  return cents
}

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Payment amount must be a non-negative integer number of cents."
    )
  }
  const whole = Math.floor(cents / 100)
  const fraction = String(cents % 100).padStart(2, "0")
  return `${whole}.${fraction}`
}

export function requireCents(value: unknown, label: string): number {
  const cents = majorToCents(value)
  if (cents == null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} is not a USD amount with at most two decimal places.`
    )
  }
  return cents
}
