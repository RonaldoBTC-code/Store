import { randomBytes } from "crypto"
import { hashPersonal, personalDataSecret } from "./limits"

export const STATUS_NOT_FOUND = "No encontramos el carrito."

export const STATUS_RATE_LIMITED =
  "Demasiadas consultas. Espera un momento e inténtalo de nuevo."

const DEFAULT_MAX_REQUESTS = 30
const DEFAULT_WINDOW_SECONDS = 60

export type StatusQuery = {
  cartId: string
  paymentSessionId: string
}

/**
 * Invoice id is never a lookup key. Only the cart id and the payment
 * session id are read, so the route cannot be enumerated by invoice id.
 */
export function readStatusQuery(
  query: Record<string, unknown> | undefined
): StatusQuery {
  return {
    cartId: stringValue(query?.cart_id),
    paymentSessionId: stringValue(query?.payment_session_id),
  }
}

export function callerOwnsCart(input: {
  actorId: string | null
  cartCustomerId: string | null
  paymentSessionId: string
  cartSessionId: string | null
}): boolean {
  if (!input.paymentSessionId || input.paymentSessionId !== input.cartSessionId) {
    return false
  }
  if (input.cartCustomerId) {
    return input.actorId === input.cartCustomerId
  }
  return true
}

export const STATUS_PENDING_MESSAGE = "pago pendiente de confirmación"

export const STATUS_SETTLED_MESSAGE = "Pago confirmado."

export const STATUS_CLOSED_MESSAGE =
  "El pago con Bitcoin no se completó. Puedes intentar de nuevo."

export const STATUS_PAID_LATE_MESSAGE =
  "El pago llegó tarde y está en revisión. No se confirmó automáticamente."

export const STATUS_PAID_OVER_MESSAGE =
  "El pago supera el total y está en revisión. No se confirmó automáticamente."

export const STATUS_MISMATCH_MESSAGE = "El pago no coincide con este carrito."

export type PublicStatusState =
  | "pending"
  | "processing"
  | "settled"
  | "expired"
  | "invalid"
  | "partial"
  | "paid_late"
  | "paid_over"
  | "limit_reached"
  | "failed"
  | "cart_changed"
  | "mismatch"

export type PublicStatus = {
  state: PublicStatusState
  message: string
  expires_at?: string
  order_id?: string
}

export function publicStatus(input: PublicStatus): PublicStatus {
  const body: PublicStatus = {
    state: input.state,
    message: input.message,
  }
  if (input.expires_at) {
    body.expires_at = input.expires_at
  }
  if (input.order_id) {
    body.order_id = input.order_id
  }
  return body
}

export function statusRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env
): { maxRequests: number; windowMs: number } {
  return {
    maxRequests: positiveInt(env.BTCPAY_STATUS_MAX_REQUESTS, DEFAULT_MAX_REQUESTS),
    windowMs: positiveInt(env.BTCPAY_STATUS_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS) * 1000,
  }
}

let ephemeralRateSecret: string | null = null

export function hashRateLimitKey(value: string): string {
  const secret =
    personalDataSecret() ||
    (ephemeralRateSecret ??= randomBytes(32).toString("hex"))
  return hashPersonal(value, secret) ?? ""
}

export class StatusRateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  allow(key: string, now: number): boolean {
    const start = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((time) => time > start)
    if (recent.length >= this.maxRequests) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}

const limiters = new Map<string, StatusRateLimiter>()

/** Clears the process-wide limiter map so route tests do not share hits. */
export function resetStatusRateLimiters(): void {
  limiters.clear()
}

export function allowStatusRequest(
  keys: string[],
  now: number,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const config = statusRateLimitConfig(env)
  const limiterKey = `${config.maxRequests}:${config.windowMs}`
  let limiter = limiters.get(limiterKey)
  if (!limiter) {
    limiter = new StatusRateLimiter(config.maxRequests, config.windowMs)
    limiters.set(limiterKey, limiter)
  }
  return keys.every((key) => limiter.allow(key, now))
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
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
