import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

type Bucket = {
  start: number
  count: number
}

const buckets = new Map<string, Bucket>()

export function createPayphoneRateLimit(options: {
  scope: string
  max?: number
  windowMs?: number
  now?: () => number
}) {
  const max = options.max ?? 30
  const windowMs = options.windowMs ?? 60_000
  const now = options.now ?? Date.now

  return function payphoneRateLimit(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const key = `${options.scope}:${clientAddress(req)}`
    const current = now()
    const bucket = buckets.get(key)

    if (!bucket || current - bucket.start >= windowMs) {
      buckets.set(key, { start: current, count: 1 })
      prune(current, windowMs)
      next()
      return
    }

    bucket.count += 1
    if (bucket.count > max) {
      res.status(429).json({
        message: "Demasiados intentos. Espera un momento.",
      })
      return
    }

    next()
  }
}

function clientAddress(req: MedusaRequest) {
  return req.ip || "local"
}

function prune(current: number, windowMs: number) {
  if (buckets.size < 1000) {
    return
  }

  for (const [key, bucket] of buckets) {
    if (current - bucket.start >= windowMs) {
      buckets.delete(key)
    }
  }
}

export const limitPayphoneNotification = createPayphoneRateLimit({
  scope: "payphone-notification",
})

export const limitPayphoneComplete = createPayphoneRateLimit({
  scope: "payphone-complete",
})
