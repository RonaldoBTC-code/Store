import { createHash } from "crypto"

export const BTCPAY_PENDING_LIMIT = "BTCPAY_PENDING_LIMIT"

export const PENDING_LIMIT_MESSAGE =
  "Ya tienes un pago pendiente, termínalo o espera a que venza"

export const BTCPAY_PROVIDER = "btcpay"

/**
 * Store FAQ default invoice timer, used only until BTCPay returns expirationTime.
 * https://docs.btcpayserver.org/FAQ/Stores/
 */
export const DEFAULT_INVOICE_TTL_MS = 15 * 60 * 1000

export type LimitConfig = {
  maxPendingPerCart: number
  maxPendingPerSession: number
  maxPendingPerCustomer: number
  maxNewInvoicesPerIp: number
  newInvoiceWindowSeconds: number
  maxUnitsPerPendingOrder: number
}

export const DEFAULT_LIMITS: LimitConfig = {
  maxPendingPerCart: 1,
  maxPendingPerSession: 1,
  maxPendingPerCustomer: 2,
  maxNewInvoicesPerIp: 5,
  newInvoiceWindowSeconds: 60 * 60,
  maxUnitsPerPendingOrder: 4,
}

export type PaymentStatus =
  | "holding"
  | "pending"
  | "settled"
  | "expired"
  | "invalid"
  | "canceled"

export type PaymentRecord = {
  id: string
  provider: string
  status: PaymentStatus
  cartId: string
  customerId: string | null
  paymentSessionId: string
  invoiceId: string | null
  ipHash: string | null
  unitCount: number
  createdAt: Date
  expiresAt: Date
  reservationIds: string[]
}

export type AcquireInput = {
  cartId: string
  paymentSessionId: string
  customerId: string | null
  ipHash: string | null
  units: number
  now: Date
  limits: LimitConfig
  replaceInvoiceId?: string
}

const LIMIT_ENV: Record<keyof LimitConfig, string> = {
  maxPendingPerCart: "BTCPAY_MAX_PENDING_PER_CART",
  maxPendingPerSession: "BTCPAY_MAX_PENDING_PER_SESSION",
  maxPendingPerCustomer: "BTCPAY_MAX_PENDING_PER_CUSTOMER",
  maxNewInvoicesPerIp: "BTCPAY_MAX_NEW_INVOICES_PER_IP",
  newInvoiceWindowSeconds: "BTCPAY_NEW_INVOICE_WINDOW_SECONDS",
  maxUnitsPerPendingOrder: "BTCPAY_MAX_UNITS_PER_PENDING_ORDER",
}

export function resolveLimits(
  overrides: Partial<LimitConfig> = {},
  env: NodeJS.ProcessEnv = process.env
): LimitConfig {
  const resolved = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof LimitConfig)[]) {
    const override = overrides[key]
    if (override != null) {
      resolved[key] = positiveInt(override, DEFAULT_LIMITS[key])
      continue
    }
    resolved[key] = positiveInt(env[LIMIT_ENV[key]], DEFAULT_LIMITS[key])
  }
  return resolved
}

export function hashClientIp(ip: string): string | null {
  const trimmed = ip.trim().toLowerCase()
  if (!trimmed) {
    return null
  }
  return createHash("sha256").update(trimmed).digest("hex")
}

/**
 * True when another pending invoice must not be opened.
 * The caller uses one public error for every true result.
 */
export function invoiceLimitBlocks(
  rows: PaymentRecord[],
  input: AcquireInput
): boolean {
  if (input.units > input.limits.maxUnitsPerPendingOrder) {
    return true
  }

  const now = input.now.getTime()
  const open = rows.filter((row) => isOpenHold(row, input.replaceInvoiceId, now))

  if (count(open, (row) => row.cartId === input.cartId) >= input.limits.maxPendingPerCart) {
    return true
  }
  if (
    count(open, (row) => row.paymentSessionId === input.paymentSessionId) >=
    input.limits.maxPendingPerSession
  ) {
    return true
  }
  if (
    input.customerId &&
    count(open, (row) => row.customerId === input.customerId) >=
      input.limits.maxPendingPerCustomer
  ) {
    return true
  }
  if (input.ipHash) {
    const since = now - input.limits.newInvoiceWindowSeconds * 1000
    const created = rows.filter((row) => {
      if (input.replaceInvoiceId && row.invoiceId === input.replaceInvoiceId) {
        return false
      }
      return row.ipHash === input.ipHash && row.createdAt.getTime() >= since
    })
    if (created.length >= input.limits.maxNewInvoicesPerIp) {
      return true
    }
  }
  return false
}

function isOpenHold(
  row: PaymentRecord,
  replaceInvoiceId: string | undefined,
  now: number
): boolean {
  if (replaceInvoiceId && row.invoiceId === replaceInvoiceId) {
    return false
  }
  if (row.status !== "pending" && row.status !== "holding") {
    return false
  }
  return row.expiresAt.getTime() > now
}

function count(rows: PaymentRecord[], predicate: (row: PaymentRecord) => boolean): number {
  let total = 0
  for (const row of rows) {
    if (predicate(row)) {
      total += 1
    }
  }
  return total
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }
  return parsed
}
