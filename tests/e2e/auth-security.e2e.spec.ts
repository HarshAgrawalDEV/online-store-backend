import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, emailFor, password, runTag, type Harness } from './harness'
import { idemKey, newCustomer } from './helpers'
import { ApiError, failure, MobileApp } from './mobile'
import { tokenStore } from '@mobile/src/api/tokenStore'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h?.cleanup()
})

describe('registration and login (mobile auth service)', () => {
  it('registers, signs in and exposes only safe profile fields', async () => {
    const app = new MobileApp(emailFor('auth-ok'), password)
    const profile = await app.register('Asha')
    expect(profile).toMatchObject({ email: app.email, firstName: 'Asha', name: 'Asha' })
    const { user } = await app.me()
    const serialized = JSON.stringify(user)
    for (const secret of ['hash', 'salt', 'resetPasswordToken', 'loginAttempts', 'lockUntil'])
      expect(serialized).not.toContain(secret)
  })

  it('rejects duplicate emails, weak passwords and bad input with clear 4xx errors', async () => {
    const app = new MobileApp(emailFor('auth-dup'), password)
    await app.register()
    const dup = await failure(new MobileApp(app.email.toUpperCase(), password).register())
    expect(dup).toMatchObject({ code: 'ACCOUNT_EXISTS', status: 409 })
    const weak = await failure(new MobileApp(emailFor('auth-weak'), 'short1A').register())
    expect(weak).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 })
    const badEmail = await failure(new MobileApp('not-an-email', password).register())
    expect(badEmail.status).toBe(400)
    const noName = await failure(new MobileApp(emailFor('auth-noname'), password).register(''))
    expect(noName.status).toBe(400)
  })

  it('ignores privileged fields supplied at registration (mass assignment)', async () => {
    const email = emailFor('auth-mass')
    const response = await h.rest('POST', '/customer-auth/register', {
      body: {
        email,
        firstName: 'Mass',
        password,
        phoneVerified: true,
        role: 'super_admin',
        status: 'suspended',
        collection: 'admins',
      },
    })
    expect(response.status).toBe(201)
    const stored = await h.payload.find({
      collection: 'customers',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: email } },
    })
    expect(stored.docs[0]).toMatchObject({ phoneVerified: false, status: 'active' })
    expect(
      (
        await h.payload.find({
          collection: 'admins',
          depth: 0,
          limit: 5,
          overrideAccess: true,
          where: { email: { equals: email } },
        })
      ).totalDocs,
    ).toBe(0)
  })

  it('wrong credentials give the same answer for unknown and known emails', async () => {
    const app = new MobileApp(emailFor('auth-same'), password)
    await app.register()
    const known = await h.rest('POST', '/customers/login', {
      body: { email: app.email, password: 'WrongPassw0rd1' },
    })
    const unknown = await h.rest('POST', '/customers/login', {
      body: { email: emailFor('auth-nobody'), password: 'WrongPassw0rd1' },
    })
    expect(known.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await known.json()).toEqual(await unknown.json())
  })

  it('locks the account after repeated wrong passwords', async () => {
    const app = new MobileApp(emailFor('auth-lock'), password)
    await app.register()
    for (let i = 0; i < 5; i += 1)
      await h.rest('POST', '/customers/login', {
        body: { email: app.email, password: 'WrongPassw0rd1' },
      })
    const locked = await h.rest('POST', '/customers/login', {
      body: { email: app.email, password },
    })
    expect(locked.status).toBeGreaterThanOrEqual(401)
    expect(locked.status).toBeLessThan(500)
  })
})

describe('sessions', () => {
  it('logout ends the session so the old token stops working', async () => {
    const { app } = await newCustomer('sess-logout', false)
    const old = app.token
    expect((await h.rest('GET', '/cart', { token: old })).status).toBe(200)
    await app.logout()
    expect((await h.rest('GET', '/cart', { token: old })).status).toBe(401)
    expect(
      ((await (await h.rest('GET', '/customers/me', { token: old })).json()) as { user: unknown })
        .user,
    ).toBeNull()
  })

  it('a 401 from the server signs the app out through its token store hook', async () => {
    const { app } = await newCustomer('sess-401', false)
    let signedOut = 0
    tokenStore.onUnauthorized(() => {
      signedOut += 1
    })
    await app.logout()
    const error = await failure(app.cart())
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(signedOut).toBe(1)
    tokenStore.onUnauthorized(undefined)
  })

  it('a suspended customer is rejected cleanly (never a server error)', async () => {
    const { app } = await newCustomer('sess-suspend', false)
    const stored = await h.payload.find({
      collection: 'customers',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: app.email } },
    })
    await h.payload.update({
      collection: 'customers',
      data: { status: 'suspended' },
      id: stored.docs[0].id,
      overrideAccess: true,
    })
    const withOldToken = await h.rest('GET', '/cart', { token: app.token })
    expect([401, 403]).toContain(withOldToken.status)
    const login = await h.rest('POST', '/customers/login', { body: { email: app.email, password } })
    expect(login.status).toBe(401)
  })

  it('changing the password requires the current one and replaces it', async () => {
    const { app } = await newCustomer('sess-pw', false)
    expect(
      (await failure(app.changePassword('WrongPassw0rd1', 'BrandNewPassw0rd1'))).status,
    ).toBeGreaterThanOrEqual(400)
    expect((await failure(app.changePassword(password, 'weak'))).status).toBe(400)
    await app.changePassword(password, 'BrandNewPassw0rd1')
    expect(
      (await h.rest('POST', '/customers/login', { body: { email: app.email, password } })).status,
    ).toBe(401)
    expect(
      (
        await h.rest('POST', '/customers/login', {
          body: { email: app.email, password: 'BrandNewPassw0rd1' },
        })
      ).status,
    ).toBe(200)
  })
})

describe('profile (mobile profile service)', () => {
  it('updates name and phone, and refuses protected fields', async () => {
    const { app } = await newCustomer('prof', false)
    const updated = await app.updateProfile({
      firstName: 'Meera',
      lastName: 'Shah',
      phoneNumber: '9123456789',
    })
    expect(updated).toMatchObject({
      firstName: 'Meera',
      lastName: 'Shah',
      name: 'Meera Shah',
      phoneNumber: '+919123456789',
    })
    for (const forbidden of [
      { status: 'suspended' },
      { phoneVerified: true },
      { email: 'x@example.test' },
      { password: 'X' },
      { id: 1 },
    ]) {
      const response = await h.rest('PATCH', '/customers/me', { body: forbidden, token: app.token })
      expect(response.status, JSON.stringify(forbidden)).toBe(403)
    }
    expect((await failure(app.updateProfile({ phoneNumber: '12345' }))).status).toBe(400)
    const { app: other } = await newCustomer('prof-other', false)
    expect(
      (await failure(other.updateProfile({ phoneNumber: '9123456789' }))).status,
    ).toBeGreaterThanOrEqual(400)
  })
})

describe('input handling and error safety', () => {
  it('answers malformed JSON and bad ids with 400, not 500', async () => {
    const { app } = await newCustomer('input', false)
    const send = (method: string, path: string, raw: string) =>
      fetch(`http://api.test/api${path}`, {
        body: raw,
        headers: { Authorization: `JWT ${app.token}`, 'Content-Type': 'application/json' },
        method,
      })
    for (const [method, path] of [
      ['POST', '/cart/items'],
      ['POST', '/checkout/preview'],
      ['POST', '/checkout/place-order'],
      ['POST', '/addresses'],
      ['POST', '/wishlist/items'],
      ['POST', '/cart/apply-coupon'],
    ] as const) {
      const response = await send(method, path, '{not json')
      expect(response.status, `${method} ${path}`).toBe(400)
    }
    for (const path of ['/my-orders/abc', '/my-orders/-1', '/wishlist/check/abc']) {
      expect((await h.rest('GET', path, { token: app.token })).status, path).toBe(400)
    }
    expect(
      (await h.rest('PATCH', '/addresses/abc', { body: { city: 'X' }, token: app.token })).status,
    ).toBe(400)
    expect((await h.rest('DELETE', '/addresses/abc', { token: app.token })).status).toBe(400)
    expect((await h.rest('GET', '/catalog/products?limit=1000')).status).toBe(400)
    expect((await h.rest('GET', '/catalog/products?sort=hacked')).status).toBe(400)
    expect((await h.rest('GET', '/wishlist?limit=1000', { token: app.token })).status).toBe(400)
  })

  it('never echoes stack traces or SQL in error bodies', async () => {
    const { app } = await newCustomer('leak', false)
    const bodies: string[] = []
    for (const [method, path, body] of [
      ['POST', '/cart/items', { variantId: 999999999, quantity: 1 }],
      ['GET', '/my-orders/999999999'],
      ['POST', '/checkout/place-order', { addressId: 1, idempotencyKey: 'x' }],
    ] as const) {
      bodies.push(await (await h.rest(method, path, { body, token: app.token })).text())
    }
    for (const text of bodies) {
      for (const marker of [
        'SELECT ',
        'INSERT ',
        'node_modules',
        ' at async',
        'drizzle',
        'pg_',
        'stack',
      ])
        expect(text).not.toContain(marker)
    }
  })

  it('does not trust prices, totals or ownership supplied by the client', async () => {
    const product = await h.catalog.product({
      name: 'Sec trusted price',
      pricePaise: 100_000,
      stock: 5,
    })
    await h.setShipping({
      codEnabled: true,
      codFeePaise: 0,
      freeShippingAbovePaise: 0,
      standardFeePaise: 0,
    })
    const { address, app } = await newCustomer('sec-price')
    const added = await h.rest('POST', '/cart/items', {
      body: {
        quantity: 1,
        unitPricePaise: 1,
        variantId: product.variantId,
        priceOverride: 1,
        customer: 1,
      },
      token: app.token,
    })
    expect(added.status).toBe(201)
    const cart = await app.cart()
    expect(cart.lines[0].unitPrice).toBe(100_000)
    const placed = await h.rest('POST', '/checkout/place-order', {
      body: {
        addressId: Number(address!.id),
        customer: 1,
        discountPaise: 99_999,
        grandTotalPaise: 1,
        idempotencyKey: idemKey('price'),
        paymentMethod: 'cod',
        status: 'delivered',
      },
      token: app.token,
    })
    expect(placed.status).toBe(201)
    const order = (
      (await placed.json()) as {
        data: { order: { grandTotalPaise: number; status: string; discountPaise: number } }
      }
    ).data.order
    expect(order).toMatchObject({ discountPaise: 0, grandTotalPaise: 100_000, status: 'confirmed' })
  })

  it('rejects addresses with unsupported or ownership fields', async () => {
    const { app } = await newCustomer('sec-addr', false)
    for (const extra of [{ customer: 1 }, { isActive: false }, { id: 5 }]) {
      const response = await h.rest('POST', '/addresses', {
        body: {
          city: 'Jaipur',
          line1: '1 Road',
          phoneNumber: '9876543210',
          pincode: '302001',
          recipientName: 'X',
          stateCode: 'RJ',
          ...extra,
        },
        token: app.token,
      })
      expect(response.status, JSON.stringify(extra)).toBe(403)
    }
    for (const bad of [{ pincode: '12' }, { phoneNumber: '1' }, { stateCode: 'XX' }]) {
      const response = await h.rest('POST', '/addresses', {
        body: {
          city: 'Jaipur',
          line1: '1 Road',
          phoneNumber: '9876543210',
          pincode: '302001',
          recipientName: 'X',
          stateCode: 'RJ',
          ...bad,
        },
        token: app.token,
      })
      expect(response.status, JSON.stringify(bad)).toBe(400)
    }
  })
})

describe('rate limiting on the real stack', () => {
  it('slows login guessing and coupon guessing with 429 and Retry-After', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    const { resetRateLimits } = await import('@/lib/rate-limit')
    resetRateLimits()
    try {
      const attempts: number[] = []
      for (let i = 0; i < 12; i += 1) {
        attempts.push(
          (
            await h.rest('POST', '/customers/login', {
              body: { email: emailFor('rl'), password: 'WrongPassw0rd1' },
              headers: { 'x-forwarded-for': '198.51.100.9' },
            })
          ).status,
        )
      }
      expect(attempts.slice(0, 10).every((code) => code === 401)).toBe(true)
      expect(attempts.slice(10)).toEqual([429, 429])

      const { app } = await newCustomer('rl-coupon', false)
      const codes: number[] = []
      let retryAfter: string | null = null
      for (let i = 0; i < 12; i += 1) {
        const response = await h.rest('POST', '/cart/apply-coupon', {
          body: { code: `GUESS${i}` },
          token: app.token,
        })
        codes.push(response.status)
        retryAfter = response.headers.get('Retry-After') ?? retryAfter
      }
      expect(codes.filter((code) => code === 429).length).toBeGreaterThanOrEqual(2)
      expect(retryAfter).toBeTruthy()
    } finally {
      process.env.RATE_LIMIT_ENABLED = 'false'
      resetRateLimits()
    }
  })
})

describe('attack surface', () => {
  it('has GraphQL switched off', async () => {
    const [{ default: config }, routes] = await Promise.all([
      import('@payload-config'),
      import('@payloadcms/next/routes'),
    ])
    const request = new Request('http://api.test/api/graphql', {
      body: JSON.stringify({ query: '{ Products { docs { id name } } }' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    const response = await (routes.GRAPHQL_POST(config) as (req: Request) => Promise<Response>)(
      request,
    )
    const text = await response.text()
    expect(response.status === 200 && text.includes('"docs"')).toBe(false)
  })
})

void runTag
