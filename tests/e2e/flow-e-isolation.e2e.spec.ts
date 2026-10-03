import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { idemKey, newCustomer, stockOf } from './helpers'
import { failure } from './mobile'

let h: Harness
type Shopper = Awaited<ReturnType<typeof newCustomer>>
let alice: Shopper
let bob: Shopper
let bobOrderId: string
let bobOnlineOrderId: string
let bobProviderOrderId: string
let bobWishlistedProduct: number
let bobCartItemId: string
let product: { productId: number; variantId: number }

beforeAll(async () => {
  h = await startHarness()
  await h.setShipping({
    codEnabled: true,
    codFeePaise: 0,
    freeShippingAbovePaise: 0,
    standardFeePaise: 0,
  })
  product = await h.catalog.product({ name: 'E shared product', pricePaise: 100_000, stock: 20 })
  alice = await newCustomer('e-alice')
  bob = await newCustomer('e-bob')

  // Bob owns an address, a wishlist entry, a cart line, a COD order and an unpaid online order.
  await bob.app.addToWishlist(product.productId)
  bobWishlistedProduct = product.productId
  await bob.app.addToCart(product.variantId, 1, product.productId)
  const cod = await bob.app.placeOrder(
    { addressId: bob.address!.id, paymentMethod: 'cod' },
    idemKey('bob-cod'),
  )
  bobOrderId = cod.order.id
  await bob.app.addToCart(product.variantId, 1, product.productId)
  const online = await bob.app.placeOrder(
    { addressId: bob.address!.id, paymentMethod: 'upi' },
    idemKey('bob-online'),
  )
  bobOnlineOrderId = online.order.id
  bobProviderOrderId = online.payment!.providerOrderId
  const cart = await bob.app.addToCart(product.variantId, 1, product.productId)
  bobCartItemId = cart.lines[0].id
})
afterAll(async () => {
  await h?.cleanup()
})

const status = async (call: Promise<Response>) => (await call).status

describe('Flow E: customer A cannot reach customer B (through the mobile app)', () => {
  it('addresses', async () => {
    const id = bob.address!.id
    expect(await failure(alice.app.updateAddress(id, { city: 'Hacked' }))).toMatchObject({
      status: 404,
    })
    expect(await failure(alice.app.removeAddress(id))).toMatchObject({ status: 404 })
    expect(await failure(alice.app.setDefaultAddress(id))).toMatchObject({ status: 404 })
    expect((await alice.app.addresses()).map((a) => a.id)).not.toContain(id)
    expect((await bob.app.addresses()).find((a) => a.id === id)).toMatchObject({ city: 'Jaipur' })
  })

  it('wishlist', async () => {
    expect(await alice.app.wishlistIds()).toEqual([])
    expect(await failure(alice.app.removeFromWishlist(bobWishlistedProduct))).toMatchObject({
      status: 404,
    })
    expect(await bob.app.wishlistIds()).toEqual([String(bobWishlistedProduct)])
  })

  it('cart', async () => {
    expect((await alice.app.cart()).lines).toHaveLength(0)
    expect(await failure(alice.app.setQuantity(bobCartItemId, 9))).toMatchObject({ status: 404 })
    expect(await failure(alice.app.removeItem(bobCartItemId))).toMatchObject({ status: 404 })
    expect((await bob.app.cart()).lines[0]).toMatchObject({ id: bobCartItemId, quantity: 1 })
  })

  it('orders and payments', async () => {
    expect((await alice.app.orders()).map((o) => o.id)).not.toContain(bobOrderId)
    for (const id of [bobOrderId, bobOnlineOrderId]) {
      expect(await failure(alice.app.order(id))).toMatchObject({
        code: 'ORDER_NOT_FOUND',
        status: 404,
      })
      expect(await failure(alice.app.cancelOrder(id))).toMatchObject({ status: 404 })
      expect(await failure(alice.app.retryPayment(id))).toMatchObject({ status: 404 })
    }
    const paid = h.gateway.pay(bobProviderOrderId)
    expect(
      await failure(
        alice.app.verifyPayment({
          razorpayOrderId: paid.razorpay_order_id,
          razorpayPaymentId: paid.razorpay_payment_id,
          razorpaySignature: paid.razorpay_signature,
        }),
      ),
    ).toMatchObject({ status: 404 })
    expect((await bob.app.order(bobOnlineOrderId)).status).toBe('pending_payment')
  })

  it('checkout with another customer address', async () => {
    await alice.app.addToCart(product.variantId, 1, product.productId)
    const error = await failure(
      alice.app.preview({ addressId: bob.address!.id, paymentMethod: 'cod' }),
    )
    expect(error.status).toBeGreaterThanOrEqual(400)
    expect(error.status).toBeLessThan(500)
    const order = await failure(
      alice.app.placeOrder({ addressId: bob.address!.id, paymentMethod: 'cod' }, idemKey('steal')),
    )
    expect(order.status).toBeLessThan(500)
  })

  it('an idempotency key from another customer does not leak their order', async () => {
    const key = idemKey('shared-key')
    const first = await bob.app.placeOrder(
      { addressId: bob.address!.id, paymentMethod: 'cod' },
      key,
    )
    await alice.app.addToCart(product.variantId, 1, product.productId)
    const second = await alice.app.placeOrder(
      { addressId: alice.address!.id, paymentMethod: 'cod' },
      key,
    )
    expect(second.order.id).not.toBe(first.order.id)
    expect(second.order.address?.recipientName).toBeDefined()
  })
})

describe('Flow E: Payload built-in REST routes with a customer token', () => {
  it('lets a customer read only their own customer record, and never write one', async () => {
    const own = (await (await h.rest('GET', '/customers', { token: alice.app.token })).json()) as {
      docs: { id: number; email: string }[]
    }
    expect(own.docs.map((d) => d.email)).toEqual([alice.app.email])
    const bobId = bob.app.profile!.id
    expect([403, 404]).toContain(
      await status(h.rest('GET', `/customers/${bobId}`, { token: alice.app.token })),
    )
    for (const target of [bobId, alice.app.profile!.id]) {
      expect(
        await status(
          h.rest('PATCH', `/customers/${target}`, {
            body: { firstName: 'X' },
            token: alice.app.token,
          }),
        ),
      ).toBeGreaterThanOrEqual(403)
      expect(
        await status(h.rest('DELETE', `/customers/${target}`, { token: alice.app.token })),
      ).toBeGreaterThanOrEqual(403)
    }
    expect(
      await status(
        h.rest('POST', '/customers', {
          body: { email: 'x@example.test', password: 'E2ePassw0rdSecure' },
        }),
      ),
    ).toBeGreaterThanOrEqual(403)
    expect(
      await status(
        h.rest('POST', '/customers', {
          body: { email: 'x@example.test', password: 'E2ePassw0rdSecure' },
          token: alice.app.token,
        }),
      ),
    ).toBeGreaterThanOrEqual(403)
  })

  it('hides other customers shopping data and blocks direct writes', async () => {
    for (const collection of [
      'carts',
      'cart-items',
      'wishlists',
      'wishlist-items',
      'customer-addresses',
    ]) {
      const list = (await (
        await h.rest('GET', `/${collection}?limit=50&depth=0`, { token: alice.app.token })
      ).json()) as { docs?: { customer?: unknown }[] }
      const json = JSON.stringify(list.docs ?? [])
      expect(json, collection).not.toContain(bob.app.email)
      expect(
        await status(h.rest('POST', `/${collection}`, { body: {}, token: alice.app.token })),
        `${collection} create`,
      ).toBeGreaterThanOrEqual(403)
    }
    const bobAddress = Number(bob.address!.id)
    expect([403, 404]).toContain(
      await status(h.rest('GET', `/customer-addresses/${bobAddress}`, { token: alice.app.token })),
    )
    expect(
      await status(
        h.rest('PATCH', `/customer-addresses/${bobAddress}`, {
          body: { city: 'Hacked' },
          token: alice.app.token,
        }),
      ),
    ).toBeGreaterThanOrEqual(403)
    expect(
      await status(
        h.rest('DELETE', `/customer-addresses/${bobAddress}`, { token: alice.app.token }),
      ),
    ).toBeGreaterThanOrEqual(403)
  })

  it('keeps every commerce and inventory collection staff-only', async () => {
    for (const collection of [
      'orders',
      'order-items',
      'order-status-events',
      'payment-attempts',
      'payment-webhook-events',
      'inventory-reservations',
      'coupon-redemptions',
      'inventory',
      'inventory-movements',
    ]) {
      for (const token of [undefined, alice.app.token, bob.app.token]) {
        const response = await h.rest('GET', `/${collection}?limit=5`, { token })
        expect(
          response.status,
          `${collection} ${token ? 'customer' : 'anonymous'}`,
        ).toBeGreaterThanOrEqual(401)
        expect(response.status).toBeLessThan(500)
      }
    }
    expect(
      await status(h.rest('GET', `/orders/${bobOrderId}`, { token: alice.app.token })),
    ).toBeGreaterThanOrEqual(403)
    expect(
      await status(
        h.rest('PATCH', `/orders/${bobOrderId}`, {
          body: { status: 'delivered' },
          token: bob.app.token,
        }),
      ),
    ).toBeGreaterThanOrEqual(403)
  })

  it('does not let customers into staff endpoints or the admin collection', async () => {
    const token = alice.app.token
    expect(
      await status(
        h.rest('POST', `/admin/orders/${bobOrderId}/status`, {
          body: { status: 'delivered' },
          token,
        }),
      ),
    ).toBe(403)
    expect(
      await status(
        h.rest('POST', '/admin/inventory/adjust', {
          body: { variantId: product.variantId, delta: 100 },
          token,
        }),
      ),
    ).toBeGreaterThanOrEqual(403)
    expect(
      await status(h.rest('POST', '/admin/inventory-reservations/expire', { body: {}, token })),
    ).toBe(403)
    expect(await status(h.rest('GET', '/admins?limit=5', { token }))).toBeGreaterThanOrEqual(403)
    expect(
      await status(
        h.rest('POST', '/admins/login', {
          body: { email: alice.app.email, password: 'E2ePassw0rdSecure' },
        }),
      ),
    ).toBeGreaterThanOrEqual(400)
    const me = (await (await h.rest('GET', '/admins/me', { token })).json()) as { user: unknown }
    expect(me.user).toBeNull()
    expect(await stockOf(h, product.variantId)).toBeDefined()
  })

  it('refuses anonymous access to every customer-only mobile route', async () => {
    const routes: [string, string][] = [
      ['GET', '/cart'],
      ['GET', '/wishlist'],
      ['GET', '/addresses'],
      ['GET', '/my-orders'],
      ['GET', `/my-orders/${bobOrderId}`],
      ['POST', '/cart/items'],
      ['POST', '/checkout/preview'],
      ['POST', '/checkout/place-order'],
      ['POST', '/payments/verify'],
    ]
    for (const [method, path] of routes) {
      for (const token of [undefined, 'not-a-real-token']) {
        const response = await h.rest(method, path, {
          body: method === 'POST' ? {} : undefined,
          token,
        })
        expect(response.status, `${method} ${path}`).toBe(401)
      }
    }
  })
})
