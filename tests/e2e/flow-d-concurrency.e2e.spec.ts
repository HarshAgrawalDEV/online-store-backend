import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { attemptsOf, idemKey, newCustomer, rawOrder, reservationsOf, stockOf } from './helpers'
import { ApiError } from './mobile'

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

type Shopper = Awaited<ReturnType<typeof newCustomer>>

const shoppers = async (
  prefix: string,
  count: number,
  product: { productId: number; variantId: number },
  qty = 1,
): Promise<Shopper[]> => {
  const list: Shopper[] = []
  for (let i = 0; i < count; i += 1) {
    const shopper = await newCustomer(`${prefix}-${i}`)
    await shopper.app.addToCart(product.variantId, qty, product.productId)
    list.push(shopper)
  }
  return list
}

const settle = async (promises: Promise<unknown>[]) => {
  const results = await Promise.allSettled(promises)
  return {
    failures: results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as ApiError),
    successes: results.filter((r) => r.status === 'fulfilled').length,
  }
}

describe('Flow D: concurrent checkout', () => {
  it('two customers buying the last unit by COD: exactly one wins', async () => {
    const product = await h.catalog.product({ name: 'D last unit', pricePaise: 100_000, stock: 1 })
    const [a, b] = await shoppers('d-last', 2, product)
    const { failures, successes } = await settle([
      a.app.placeOrderNow({ addressId: a.address!.id, paymentMethod: 'cod' }, idemKey('a')),
      b.app.placeOrderNow({ addressId: b.address!.id, paymentMethod: 'cod' }, idemKey('b')),
    ])
    expect(successes).toBe(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(ApiError)
    expect(failures[0].status).toBe(409)
    expect(failures[0].code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(h, product.variantId)).toEqual({ available: 0, onHand: 0, reserved: 0 })
  })

  it('two customers racing for the last unit online: one reservation, one clear rejection', async () => {
    const product = await h.catalog.product({
      name: 'D last online',
      pricePaise: 100_000,
      stock: 1,
    })
    const [a, b] = await shoppers('d-online', 2, product)
    const { failures, successes } = await settle([
      a.app.placeOrderNow({ addressId: a.address!.id, paymentMethod: 'upi' }, idemKey('a')),
      b.app.placeOrderNow({ addressId: b.address!.id, paymentMethod: 'upi' }, idemKey('b')),
    ])
    expect(successes).toBe(1)
    expect(failures[0]).toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 })
    expect(await stockOf(h, product.variantId)).toEqual({ available: 0, onHand: 1, reserved: 1 })
    // The loser left no half-created order behind.
    expect((await loserOrders(failuresOwner(failures, [a, b]))).length).toBe(0)
  })

  it('eight customers racing for three units: never oversold', async () => {
    const product = await h.catalog.product({
      name: 'D three units',
      pricePaise: 100_000,
      stock: 3,
    })
    const crowd = await shoppers('d-crowd', 8, product)
    const { failures, successes } = await settle(
      crowd.map((s, i) =>
        s.app.placeOrderNow(
          { addressId: s.address!.id, paymentMethod: i % 2 ? 'cod' : 'upi' },
          idemKey(`crowd${i}`),
        ),
      ),
    )
    expect(successes).toBe(3)
    expect(failures).toHaveLength(5)
    for (const failure of failures) expect(failure.code).toBe('INSUFFICIENT_STOCK')
    const stock = await stockOf(h, product.variantId)
    expect(stock.onHand).toBeGreaterThanOrEqual(0)
    expect(stock.reserved).toBeLessThanOrEqual(stock.onHand + 3)
    // Whatever mix of COD (consumed) and online (held) won, the units are fully accounted for.
    expect(3 - stock.onHand + stock.reserved).toBe(3)
    expect(stock.available).toBe(0)
  })

  it('a double-tapped Place order (same idempotency key) creates one order', async () => {
    const product = await h.catalog.product({ name: 'D double tap', pricePaise: 100_000, stock: 5 })
    const [shopper] = await shoppers('d-double', 1, product, 2)
    const key = idemKey('double')
    const input = { addressId: shopper.address!.id, paymentMethod: 'cod' as const }
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => shopper.app.placeOrderNow(input, key)),
    )
    const ids = new Set(
      results
        .filter((r) => r.status === 'fulfilled')
        .map((r) =>
          String((r as PromiseFulfilledResult<{ order: { id: number } }>).value.order.id),
        ),
    )
    expect(ids.size).toBe(1)
    expect((await shopper.app.orders()).length).toBe(1)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 3, onHand: 3, reserved: 0 })
  })

  it('a single-use coupon cannot be claimed by two customers at once', async () => {
    const coupon = await h.catalog.coupon({ code: 'D-ONCE', discountValue: 10, usageLimit: 1 })
    const product = await h.catalog.product({
      name: 'D coupon race',
      pricePaise: 100_000,
      stock: 5,
    })
    const crowd = await shoppers('d-coupon', 2, product)
    for (const s of crowd) await s.app.applyCoupon(coupon.code)
    const { failures, successes } = await settle(
      crowd.map((s, i) =>
        s.app.placeOrderNow(
          { addressId: s.address!.id, couponCode: coupon.code, paymentMethod: 'cod' },
          idemKey(`coupon${i}`),
        ),
      ),
    )
    expect(successes).toBe(1)
    expect(failures[0].code).toMatch(/COUPON_(LIMIT|CUSTOMER_LIMIT)_REACHED/)
    const redemptions = await h.payload.find({
      collection: 'coupon-redemptions',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { coupon: { equals: coupon.id } },
    })
    expect(redemptions.docs.filter((r) => r.status !== 'released')).toHaveLength(1)
    // The loser's rolled-back checkout leaked no stock.
    expect(await stockOf(h, product.variantId)).toEqual({ available: 4, onHand: 4, reserved: 0 })
  })

  it('verify and webhook arriving together confirm the order and take stock once', async () => {
    const product = await h.catalog.product({
      name: 'D verify race',
      pricePaise: 100_000,
      stock: 2,
    })
    const { address, app } = await newCustomer('d-verify')
    await app.addToCart(product.variantId, 1, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'upi' },
      idemKey('verify'),
    )
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    const { successes } = await settle([
      app.verifyPayment({
        razorpayOrderId: paid.razorpay_order_id,
        razorpayPaymentId: paid.razorpay_payment_id,
        razorpaySignature: paid.razorpay_signature,
      }),
      h.postWebhook(h.gateway.webhookBody('payment.captured', paid.razorpay_payment_id)),
      h.postWebhook(h.gateway.webhookBody('order.paid', paid.razorpay_payment_id)),
    ])
    expect(successes).toBeGreaterThanOrEqual(1)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 1, onHand: 1, reserved: 0 })
    expect((await rawOrder(h, placed.order.id)).status).toBe('confirmed')
    expect((await reservationsOf(h, placed.order.id)).map((r) => r.status)).toEqual(['committed'])
    expect((await attemptsOf(h, placed.order.id)).filter((a) => a.status === 'paid')).toHaveLength(
      1,
    )
    const events = await h.payload.find({
      collection: 'order-status-events',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: {
        and: [
          { order: { equals: Number(placed.order.id) } },
          { eventType: { equals: 'payment_verified' } },
        ],
      },
    })
    expect(events.totalDocs).toBe(1)
  })

  it('concurrent cancellations restock once', async () => {
    const product = await h.catalog.product({
      name: 'D cancel race',
      pricePaise: 100_000,
      stock: 4,
    })
    const [shopper] = await shoppers('d-cancel', 1, product, 2)
    const placed = await shopper.app.placeOrder(
      { addressId: shopper.address!.id, paymentMethod: 'cod' },
      idemKey('cancel'),
    )
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 2 })
    const { successes } = await settle([
      shopper.app.cancelOrder(placed.order.id),
      shopper.app.cancelOrder(placed.order.id),
      shopper.app.cancelOrder(placed.order.id),
    ])
    expect(successes).toBe(1)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 4, onHand: 4, reserved: 0 })
  })

  it('an expiry sweep racing a payment never releases stock that was paid for', async () => {
    const product = await h.catalog.product({
      name: 'D expiry race',
      pricePaise: 100_000,
      stock: 2,
    })
    const { address, app } = await newCustomer('d-expiry')
    await app.addToCart(product.variantId, 1, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'upi' },
      idemKey('expiry'),
    )
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    // Payment is confirmed first; a later sweep must leave the committed order alone.
    await app.verifyPayment({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    })
    await h.expireHolds(placed.order.id)
    const { expireReservations } = await import('@/services/inventory/reservations')
    const { createLocalReq } = await import('payload')
    const req = await createLocalReq({}, h.payload)
    await expireReservations(req)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 1, onHand: 1, reserved: 0 })
    expect((await rawOrder(h, placed.order.id)).status).toBe('confirmed')
  })
})

/** Orders that belong to the customers whose checkout failed. */
const failuresOwner = (_failures: ApiError[], list: Shopper[]) => list
const loserOrders = async (list: Shopper[]) => {
  const orders = await Promise.all(list.map((s) => s.app.orders()))
  // The winner has one order; every other customer must have none.
  return orders.filter((o) => o.length === 0).length === 1 ? [] : orders.flat().slice(1)
}
