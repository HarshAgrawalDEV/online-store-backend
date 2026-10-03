import { APIError, type Endpoint, type PayloadRequest } from 'payload'

import { apiError } from './api-response'

/**
 * In-process fixed-window rate limiter.
 *
 * Counters live in this Node process, so limits are per server instance. That is the right
 * trade-off for a single instance; if the API is scaled out, swap `store` for a shared
 * (Redis) implementation behind the same `consume` contract.
 */
export type RatePolicy = {
  /** Requests allowed per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

type Counter = { count: number; resetAt: number }

const MAX_TRACKED_KEYS = 50_000
const store = new Map<string, Counter>()
let lastSweep = 0

const enabled = (): boolean => process.env.RATE_LIMIT_ENABLED !== 'false'

const sweep = (now: number): void => {
  if (now - lastSweep < 60_000 && store.size < MAX_TRACKED_KEYS) return
  lastSweep = now
  for (const [key, counter] of store) {
    if (counter.resetAt <= now) store.delete(key)
  }
  // Hard cap: under attack with unique keys, drop the oldest entries rather than grow unbounded.
  if (store.size >= MAX_TRACKED_KEYS) {
    for (const key of store.keys()) {
      store.delete(key)
      if (store.size < MAX_TRACKED_KEYS * 0.9) break
    }
  }
}

export type ConsumeResult = { allowed: boolean; retryAfterSeconds: number }

export const consume = (key: string, policy: RatePolicy, now = Date.now()): ConsumeResult => {
  if (!enabled()) return { allowed: true, retryAfterSeconds: 0 }
  sweep(now)
  const current = store.get(key)
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + policy.windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  current.count += 1
  if (current.count > policy.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

export const resetRateLimits = (): void => store.clear()

/**
 * Client address. Forwarded headers are spoofable unless a trusted proxy overwrites them, so the
 * address is taken `TRUSTED_PROXY_HOPS` entries from the right (default 1: one load balancer).
 */
export const clientIp = (req: Pick<PayloadRequest, 'headers'>): string => {
  const forwarded = req.headers?.get?.('x-forwarded-for')
  if (forwarded) {
    const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1))
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const ip = parts[Math.max(0, parts.length - hops)]
    if (ip) return ip
  }
  return req.headers?.get?.('x-real-ip') ?? 'local'
}

/** Signed-in callers are limited per account (not spoofable); anonymous callers per address. */
const identityKey = (req: PayloadRequest): string =>
  req.user ? `${req.user.collection}:${req.user.id}` : `ip:${clientIp(req)}`

export const policies = {
  /** Account creation: slow down mass registration from one address. */
  register: { limit: 5, windowMs: 60 * 60_000 },
  /** Login and password recovery attempts per address. */
  authAttempt: { limit: 10, windowMs: 15 * 60_000 },
  /** Sensitive account changes such as changing the password. */
  accountChange: { limit: 5, windowMs: 15 * 60_000 },
  /** Coupon guessing. */
  coupon: { limit: 10, windowMs: 60_000 },
  /** Placing and previewing orders, payment verification and retries. */
  checkout: { limit: 20, windowMs: 60_000 },
  /** Anonymous catalog reads. */
  publicRead: { limit: 120, windowMs: 60_000 },
  /** Everything else that is authenticated or mutates data. */
  standard: { limit: 120, windowMs: 60_000 },
  /** Staff-only operations. */
  admin: { limit: 60, windowMs: 60_000 },
  /** Payment provider callbacks: generous, signature-verified, just blunts floods. */
  webhook: { limit: 600, windowMs: 60_000 },
} satisfies Record<string, RatePolicy>

export type PolicyName = keyof typeof policies

/** First matching rule wins; paths are relative to /api. */
const rules: Array<{ match: RegExp; policy: PolicyName }> = [
  { match: /^\/customer-auth\/register$/, policy: 'register' },
  { match: /^\/customer-auth\/change-password$/, policy: 'accountChange' },
  { match: /^\/cart\/apply-coupon$/, policy: 'coupon' },
  {
    match: /^\/(checkout|payments\/verify|my-orders\/[^/]+\/(retry-payment|cancel))/,
    policy: 'checkout',
  },
  { match: /^\/payments\/webhooks\//, policy: 'webhook' },
  { match: /^\/admin\//, policy: 'admin' },
  { match: /^\/catalog\//, policy: 'publicRead' },
]

export const policyForPath = (path: string): PolicyName =>
  rules.find((rule) => rule.match.test(path))?.policy ?? 'standard'

export const rateLimited = (
  req: PayloadRequest,
  message = 'Too many requests. Please try again shortly.',
  retryAfterSeconds = 60,
): Response => {
  const response = apiError(req, 'RATE_LIMITED', message, 429)
  response.headers.set('Retry-After', String(retryAfterSeconds))
  return response
}

/** Wrap a custom endpoint so it answers 429 once its policy is exceeded. */
export const withRateLimit = (endpoint: Endpoint): Endpoint => {
  const policyName = policyForPath(endpoint.path)
  const policy = policies[policyName]
  return {
    ...endpoint,
    handler: async (req) => {
      const result = consume(`${policyName}:${endpoint.path}:${identityKey(req)}`, policy)
      if (!result.allowed) return rateLimited(req, undefined, result.retryAfterSeconds)
      return endpoint.handler(req)
    },
  }
}

/**
 * Collection `beforeOperation` hook for Payload's built-in auth routes, which bypass custom
 * endpoints: login, forgot-password and reset-password are limited per address.
 */
export const limitAuthOperations = ({
  operation,
  req,
}: {
  operation: string
  req: PayloadRequest
}): void => {
  if (!['forgotPassword', 'login', 'resetPassword'].includes(operation)) return
  const result = consume(`auth:${operation}:ip:${clientIp(req)}`, policies.authAttempt)
  if (!result.allowed) {
    throw new APIError(
      `Too many attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minute(s).`,
      429,
    )
  }
}
