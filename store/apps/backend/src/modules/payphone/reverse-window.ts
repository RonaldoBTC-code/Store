const ECUADOR_OFFSET_HOURS = 5
const REVERSE_DEADLINE_MINUTES = 20 * 60

/**
 * PayPhone documents that API Reverse is only available on the same calendar
 * day as the sale, until 20:00 America/Guayaquil.
 * https://docs.payphone.app/api-reverse
 *
 * Confirm responses in the docs show a datetime without a timezone
 * (`2023-10-10T11:57:26.367`). Those values are treated as Ecuador local time.
 * Returns null when the timestamp cannot be read, so the caller can still
 * ask PayPhone and surface their error.
 */
export function payphoneReverseAllowed(
  transactionDate: string | undefined | null,
  now: Date
): boolean | null {
  if (!transactionDate) {
    return null
  }

  const parsed = parsePayphoneDate(transactionDate)
  if (!parsed) {
    return null
  }

  const sale = ecuadorParts(parsed)
  const current = ecuadorParts(now)

  if (
    sale.year !== current.year ||
    sale.month !== current.month ||
    sale.day !== current.day
  ) {
    return false
  }

  return current.minutes <= REVERSE_DEADLINE_MINUTES
}

function parsePayphoneDate(value: string): Date | null {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? "0")
  const utc = Date.UTC(
    year,
    month - 1,
    day,
    hour + ECUADOR_OFFSET_HOURS,
    minute,
    second
  )

  const date = new Date(utc)
  return Number.isNaN(date.getTime()) ? null : date
}

function ecuadorParts(date: Date): {
  year: number
  month: number
  day: number
  minutes: number
} {
  const shifted = new Date(date.getTime() - ECUADOR_OFFSET_HOURS * 60 * 60 * 1000)

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}
