import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { idemKey, newCustomer } from './helpers'
import { failure } from './mobile'
import { tokenStore } from '@mobile/src/api/tokenStore'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
  await h.setShipping({
    codEnabled: true,
    codFeePaise: 0,
    freeShippingAbovePaise: 0,
    standardFeePaise: 0,
  })
})
afterAll(async () => {
  await h?.cleanup()
})

const INTERNAL = [
  'requestHash',
  'idempotencyKey',
  'pricingBreakdown',
  'exceptionCode',
  'billingAddressSnapshot',
  'actorId',
  'metadata',
  '"customer"',
  '"cart"',
]

describe('customer responses expose only what the app needs', () => {
  it('orders: list, detail, place, verify and cancel carry no internal fields', async () => {
    const product = await h.catalog.product({
      name: 'Contract item',
      pricePaise: 100_000,
      stock: 9,
    })
    const { address, app } = await newCustomer('contract-orders')
    await app.addToCart(product.variantId, 1, product.productId)
    const online = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'upi' },
      idemKey('contract'),
    )
    const paid = h.gateway.pay(online.payment!.providerOrderId)
    const verified = await app.verifyPayment({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    })
    await app.addToCart(product.variantId, 1, product.productId)
    const cod = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('contract-cod'),
    )

    const raw = {
      detail: await (
        await h.rest('GET', `/my-orders/${cod.order.id}`, { token: app.token })
      ).text(),
      list: await (await h.rest('GET', '/my-orders', { token: app.token })).text(),
      place: JSON.stringify(cod),
      verify: JSON.stringify(verified),
    }
    const cancelResponse = await h.rest('POST', `/my-orders/${cod.order.id}/cancel`, {
      body: { reason: 'Testing' },
      token: app.token,
    })
    const cancelText = await cancelResponse.text()
    for (const [label, text] of Object.entries({ ...raw, cancel: cancelText })) {
      for (const field of INTERNAL) expect(text, `${label} leaks ${field}`).not.toContain(field)
    }

    // The cancel response is a full order, so the app can render it without another request.
    const cancelled = (
      JSON.parse(cancelText) as {
        data: { items: unknown[]; statusEvents: { toStatus: string }[]; status: string }
      }
    ).data
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.items).toHaveLength(1)
    expect(cancelled.statusEvents.map((e) => e.toStatus)).toContain('cancelled')
  })

  it('does not reveal internal staff notes in the order timeline', async () => {
    const product = await h.catalog.product({
      name: 'Contract note item',
      pricePaise: 100_000,
      stock: 9,
    })
    const { address, app } = await newCustomer('contract-notes')
    await app.addToCart(product.variantId, 1, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('contract-notes'),
    )
    const staff = await h.rest('POST', `/admin/orders/${placed.order.id}/status`, {
      body: { reason: 'INTERNAL: supplier delay', status: 'processing' },
      token: (
        (await (
          await h.rest('POST', '/admins/login', {
            body: { email: h.admin.email, password: 'E2ePassw0rdSecure' },
          })
        ).json()) as { token: string }
      ).token,
    })
    expect(staff.status).toBe(200)
    const text = await (
      await h.rest('GET', `/my-orders/${placed.order.id}`, { token: app.token })
    ).text()
    expect(text).not.toContain('supplier delay')
    expect(text).toContain('processing')
  })

  it('checkout preview returns amounts and lines, not stored records', async () => {
    const product = await h.catalog.product({
      name: 'Contract preview',
      pricePaise: 100_000,
      stock: 9,
    })
    const { address, app } = await newCustomer('contract-preview')
    await app.addToCart(product.variantId, 1, product.productId)
    const response = await h.rest('POST', '/checkout/preview', {
      body: { addressId: Number(address!.id), paymentMethod: 'cod' },
      token: app.token,
    })
    const data = ((await response.json()) as { data: Record<string, unknown> }).data
    expect(Object.keys(data).sort()).toEqual([
      'addressId',
      'cartId',
      'codFeePaise',
      'coupon',
      'currency',
      'discountPaise',
      'grandTotalPaise',
      'itemsSubtotalPaise',
      'lines',
      'paymentMethod',
      'shippingPaise',
      'shippingPolicy',
      'taxPaise',
      'taxPolicy',
    ])
  })
})

describe('errors the app can rely on', () => {
  it('uses one error envelope everywhere', async () => {
    const { app } = await newCustomer('contract-errors', false)
    const probes: Array<[string, Promise<Response>]> = [
      ['catalog 404', h.rest('GET', '/catalog/products/999999999')],
      ['catalog 400', h.rest('GET', '/catalog/products?limit=999')],
      ['cart 400', h.rest('POST', '/cart/items', { body: { variantId: 'x' }, token: app.token })],
      [
        'cart 404',
        h.rest('PATCH', '/cart/items/999999999', { body: { quantity: 1 }, token: app.token }),
      ],
      ['orders 404', h.rest('GET', '/my-orders/999999999', { token: app.token })],
      ['auth 401', h.rest('GET', '/cart')],
      ['inventory 403', h.rest('POST', '/admin/inventory/adjust', { body: {}, token: app.token })],
    ]
    for (const [label, pending] of probes) {
      const response = await pending
      const body = (await response.json()) as {
        error?: { code?: string; message?: string }
        success?: boolean
      }
      expect(response.status, label).toBeGreaterThanOrEqual(400)
      expect(body.success, label).toBe(false)
      expect(typeof body.error?.code, label).toBe('string')
      expect(typeof body.error?.message, label).toBe('string')
    }
  })

  it('answers user mistakes with 4xx that do not look like an expired session', async () => {
    const { app } = await newCustomer('contract-signout', false)
    let signedOut = 0
    tokenStore.onUnauthorized(() => {
      signedOut += 1
    })
    try {
      const wrongPassword = await failure(app.changePassword('WrongPassw0rd1', 'BrandNewPassw0rd1'))
      expect(wrongPassword).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD', status: 400 })

      const product = await h.catalog.product({
        name: 'Contract signature',
        pricePaise: 100_000,
        stock: 3,
      })
      const { address, app: buyer } = await newCustomer('contract-signature')
      await buyer.addToCart(product.variantId, 1, product.productId)
      const placed = await buyer.placeOrder(
        { addressId: address!.id, paymentMethod: 'upi' },
        idemKey('contract-signature'),
      )
      const paid = h.gateway.pay(placed.payment!.providerOrderId)
      const forged = await failure(
        buyer.verifyPayment({
          razorpayOrderId: paid.razorpay_order_id,
          razorpayPaymentId: paid.razorpay_payment_id,
          razorpaySignature: 'forged',
        }),
      )
      expect(forged).toMatchObject({ code: 'INVALID_PAYMENT_SIGNATURE', status: 400 })

      expect(signedOut).toBe(0)
      expect((await app.cart()).count).toBe(0) // the session is still valid
    } finally {
      tokenStore.onUnauthorized(undefined)
    }
  })
})
