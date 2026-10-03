import type { Endpoint, PayloadRequest } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clientIp,
  consume,
  limitAuthOperations,
  policies,
  policyForPath,
  resetRateLimits,
  withRateLimit,
} from '@/lib/rate-limit'

const request = (headers: Record<string, string> = {}, user?: unknown) =>
  ({
    headers: new Headers(headers),
    payload: { config: {}, logger: { error: vi.fn() } },
    user,
  }) as unknown as PayloadRequest

beforeEach(() => {
  process.env.RATE_LIMIT_ENABLED = 'true'
  delete process.env.TRUSTED_PROXY_HOPS
  resetRateLimits()
})
afterEach(() => {
  process.env.RATE_LIMIT_ENABLED = 'false'
})

describe('consume', () => {
  const policy = { limit: 3, windowMs: 1000 }

  it('allows up to the limit then blocks with a retry delay', () => {
    const now = 1_000_000
    expect([1, 2, 3].map(() => consume('k', policy, now).allowed)).toEqual([true, true, true])
    const blocked = consume('k', policy, now + 100)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('opens a new window after it expires and tracks keys independently', () => {
    const now = 1_000_000
    for (let i = 0; i < 4; i++) consume('a', policy, now)
    expect(consume('a', policy, now + 1500).allowed).toBe(true)
    expect(consume('b', policy, now).allowed).toBe(true)
  })

  it('can be switched off', () => {
    process.env.RATE_LIMIT_ENABLED = 'false'
    for (let i = 0; i < 50; i++) expect(consume('x', policy).allowed).toBe(true)
  })
})

describe('clientIp', () => {
  it('uses the address added by the nearest trusted proxy, not a spoofed leftmost entry', () => {
    expect(clientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9')
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(clientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    )
  })

  it('falls back when no proxy header is present', () => {
    expect(clientIp(request())).toBe('local')
  })
})

describe('policyForPath', () => {
  it('maps sensitive routes to strict policies', () => {
    expect(policyForPath('/customer-auth/register')).toBe('register')
    expect(policyForPath('/customer-auth/change-password')).toBe('accountChange')
    expect(policyForPath('/cart/apply-coupon')).toBe('coupon')
    expect(policyForPath('/checkout/place-order')).toBe('checkout')
    expect(policyForPath('/my-orders/12/retry-payment')).toBe('checkout')
    expect(policyForPath('/payments/webhooks/razorpay')).toBe('webhook')
    expect(policyForPath('/admin/inventory/adjust')).toBe('admin')
    expect(policyForPath('/catalog/products')).toBe('publicRead')
    expect(policyForPath('/wishlist')).toBe('standard')
  })
})

describe('withRateLimit', () => {
  const ok = vi.fn(async () => Response.json({ success: true }))
  const endpoint: Endpoint = { handler: ok, method: 'post', path: '/cart/apply-coupon' }

  it('answers 429 in the API error format once the policy is exceeded', async () => {
    const limited = withRateLimit(endpoint)
    const user = { collection: 'customers', id: 5 }
    for (let i = 0; i < policies.coupon.limit; i++) {
      expect((await limited.handler(request({}, user))).status).toBe(200)
    }
    const response = await limited.handler(request({}, user))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } })
  })

  it('limits each signed-in account separately', async () => {
    const limited = withRateLimit(endpoint)
    for (let i = 0; i <= policies.coupon.limit; i++)
      await limited.handler(request({}, { collection: 'customers', id: 1 }))
    expect((await limited.handler(request({}, { collection: 'customers', id: 2 }))).status).toBe(
      200,
    )
  })
})

describe('limitAuthOperations', () => {
  const login = () =>
    limitAuthOperations({ operation: 'login', req: request({ 'x-forwarded-for': '203.0.113.7' }) })

  it('throws 429 after repeated login attempts from one address', () => {
    for (let i = 0; i < policies.authAttempt.limit; i++) expect(login).not.toThrow()
    expect(login).toThrow(/Too many attempts/)
  })

  it('ignores unrelated operations', () => {
    for (let i = 0; i < 50; i++) {
      expect(() => limitAuthOperations({ operation: 'read', req: request() })).not.toThrow()
    }
  })
})
