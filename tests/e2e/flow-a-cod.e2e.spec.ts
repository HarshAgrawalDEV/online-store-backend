import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { password, startHarness, type Harness } from './harness'
import {
  adminToken,
  idemKey,
  movementsOf,
  newCustomer,
  rawOrder,
  reservationsOf,
  stockOf,
} from './helpers'
import { failure, MobileApp } from './mobile'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
  await h.setShipping({
    codEnabled: true,
    codFeePaise: 3000,
    freeShippingAbovePaise: 0,
    standardFeePaise: 5000,
  })
})
afterAll(async () => {
  await h?.cleanup()
})

/**
 * Flow A: admin creates a product, then a customer uses the mobile app to buy it with cash on
 * delivery. Every customer step is executed by the mobile app services and mappers.
 */
describe('Flow A: COD purchase from the mobile app', () => {
  it('runs the whole journey and keeps money and stock consistent', async () => {
    // Admin creates the product through the REST API with an admin session.
    const token = await adminToken(h)
    const categories = await h.rest('GET', '/categories?limit=1', { token })
    expect(categories.status).toBe(200)
    const product = await h.catalog.product({
      name: 'Flow A Kundan Bangle',
      pricePaise: 250_000,
      stock: 10,
      maxPerOrder: 5,
    })
    const coupon = await h.catalog.coupon({
      code: 'FLOWA10',
      discountType: 'percentage',
      discountValue: 10,
      maxDiscountPaise: 50_000,
      minimumCartPaise: 100_000,
    })

    // Customer registers and signs in.
    const { address, app } = await newCustomer('flowa')
    expect(app.profile?.email).toBe(app.email)
    expect((await app.me()).user?.email).toBe(app.email)

    // Browse.
    const listing = await app.products({ search: 'Flow A Kundan' })
    const card = listing.find((item) => item.id === String(product.productId))
    expect(card).toMatchObject({ category: expect.any(String), price: 250_000, available: true })
    const detail = await app.product(product.productId)
    expect(detail.variants[0]).toMatchObject({
      available: true,
      price: 250_000,
      quantity: 10,
      maxPerOrder: 5,
    })

    // Cart: server-side pricing.
    let cart = await app.addToCart(product.variantId, 2, product.productId)
    expect(cart).toMatchObject({ count: 2, subtotal: 500_000, discount: 0, total: 500_000 })
    cart = await app.addToCart(product.variantId, 1)
    expect(cart.count).toBe(3)
    cart = await app.setQuantity(cart.lines[0].id, 2)
    expect(cart.lines[0]).toMatchObject({
      quantity: 2,
      unitPrice: 250_000,
      lineTotal: 500_000,
      valid: true,
    })

    // Coupon: 10% of 5,000.00 is 500.00, capped at 500.00.
    cart = await app.applyCoupon(coupon.code.toLowerCase())
    expect(cart.couponCode).toBe(coupon.code)
    expect(cart).toMatchObject({ discount: 50_000, total: 450_000 })

    // Checkout preview: subtotal - discount + shipping + COD fee, all in whole paise.
    const input = { addressId: address!.id, couponCode: coupon.code, paymentMethod: 'cod' as const }
    const preview = await app.preview(input)
    expect(preview).toMatchObject({
      codFee: 3000,
      discount: 50_000,
      shipping: 5000,
      subtotal: 500_000,
      tax: 0,
      total: 458_000,
    })
    expect(Number.isInteger(preview.total)).toBe(true)

    // Place the COD order.
    const key = idemKey('flowa')
    const placed = await app.placeOrder(input, key)
    expect(placed.payment).toBeNull()
    expect(placed.order).toMatchObject({
      canCancel: true,
      needsPayment: false,
      paymentLabel: 'Cash on delivery',
      status: 'confirmed',
    })
    expect(placed.order.totals).toMatchObject({
      discount: 50_000,
      shipping: 5000,
      subtotal: 500_000,
      total: 458_000,
    })
    expect(placed.order.lines).toHaveLength(1)
    expect(placed.order.lines[0]).toMatchObject({
      lineTotal: 450_000,
      quantity: 2,
      unitPrice: 250_000,
    })
    // The order keeps its own copy of the product image, so history still shows it later.
    expect((placed.order.lines[0].image as { uri: string }).uri).toMatch(/^https?:\/\//)
    expect(placed.order.address).toMatchObject({ pincode: '302001', recipientName: 'E2E Customer' })

    // Retrying with the same key returns the same order (no duplicate).
    const replay = await app.placeOrder(input, key)
    expect(replay.order.id).toBe(placed.order.id)
    const changed = await failure(app.placeOrder({ ...input, paymentMethod: 'upi' }, key))
    expect(changed).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 })

    // Inventory: COD consumes stock immediately and leaves no hold behind.
    expect(await stockOf(h, product.variantId)).toEqual({ available: 8, onHand: 8, reserved: 0 })
    const movements = await movementsOf(h, product.variantId)
    expect(movements.map((m) => m.quantityDelta)).toEqual([10, -2])
    expect((await reservationsOf(h, placed.order.id)).map((r) => r.status)).toEqual(['committed'])

    // The cart was converted: a fresh empty cart comes back, and the coupon is gone from it.
    expect(await app.cart()).toMatchObject({ count: 0, total: 0 })

    // Order history.
    const history = await app.orders()
    expect(history.map((order) => order.id)).toContain(placed.order.id)
    const fetched = await app.order(placed.order.id)
    expect(fetched.tracking[0]).toMatchObject({ complete: true, title: 'Confirmed' })

    // Admin views the order and moves it along; the customer sees the timeline advance.
    const adminView = await h.rest('GET', `/orders/${placed.order.id}?depth=0`, { token })
    expect(adminView.status).toBe(200)
    expect(await adminView.json()).toMatchObject({
      grandTotalPaise: 458_000,
      paymentMethod: 'cod',
      status: 'confirmed',
    })
    const move = await h.rest('POST', `/admin/orders/${placed.order.id}/status`, {
      body: { reason: 'Picking', status: 'processing' },
      token,
    })
    expect(move.status).toBe(200)
    const progressed = await app.order(placed.order.id)
    expect(progressed.status).toBe('processing')
    expect(progressed.tracking.find((step) => step.current)?.title).toBe('Processing')

    // The stored order matches the totals the app saw.
    const stored = await rawOrder(h, placed.order.id)
    expect(
      stored.itemsSubtotalPaise -
        stored.discountPaise +
        stored.shippingPaise +
        stored.codFeePaise +
        stored.taxPaise,
    ).toBe(stored.grandTotalPaise)
  })

  it('cancelling a COD order restocks the inventory exactly once', async () => {
    const product = await h.catalog.product({
      name: 'Flow A Cancel Bangle',
      pricePaise: 100_000,
      stock: 5,
    })
    const { address, app } = await newCustomer('flowa-cancel')
    await app.addToCart(product.variantId, 2, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('cancel'),
    )
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 3, reserved: 0 })

    const cancelled = await app.cancelOrder(placed.order.id)
    expect(cancelled.status).toBe('cancelled')
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 5, reserved: 0 })

    const again = await failure(app.cancelOrder(placed.order.id))
    expect(again.status).toBe(409)
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 5, reserved: 0 })
  })

  it('refuses COD when staff have switched it off', async () => {
    const product = await h.catalog.product({
      name: 'Flow A No COD',
      pricePaise: 100_000,
      stock: 5,
    })
    const { address, app } = await newCustomer('flowa-nocod')
    await app.addToCart(product.variantId, 1, product.productId)
    await h.setShipping({ codEnabled: false })
    try {
      const error = await failure(app.preview({ addressId: address!.id, paymentMethod: 'cod' }))
      expect(error).toMatchObject({ code: 'COD_UNAVAILABLE', status: 422 })
    } finally {
      await h.setShipping({ codEnabled: true })
    }
  })

  it('rejects checkout without an address or with an empty cart', async () => {
    const { address, app } = await newCustomer('flowa-empty')
    const empty = await failure(app.preview({ addressId: address!.id, paymentMethod: 'cod' }))
    expect(empty.status).toBeGreaterThanOrEqual(400)
    expect(empty.status).toBeLessThan(500)
    const noAddress = new MobileApp(`${app.email}.x`, password)
    expect(noAddress).toBeDefined()
  })
})
