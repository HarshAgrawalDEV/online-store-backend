import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GatewayFixture, runTag, startHarness, type Harness } from './harness'
import {
  adminToken,
  attemptsOf,
  idemKey,
  movementsOf,
  newCustomer,
  rawOrder,
  reservationsOf,
  stockOf,
} from './helpers'
import { failure } from './mobile'

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

const startOnlineOrder = async (
  name: string,
  options: { price?: number; qty?: number; stock?: number } = {},
) => {
  const { price = 200_000, qty = 1, stock = 5 } = options
  const product = await h.catalog.product({ name: `Pay ${name}`, pricePaise: price, stock })
  const { address, app } = await newCustomer(name)
  await app.addToCart(product.variantId, qty, product.productId)
  const placed = await app.placeOrder(
    { addressId: address!.id, paymentMethod: 'upi' },
    idemKey(name),
  )
  return { address: address!, app, placed, product }
}

describe('Flow B: online payment', () => {
  it('reserves stock, confirms on a verified capture and commits stock once', async () => {
    const { app, placed, product } = await startOnlineOrder('b-happy', { qty: 2 })

    // Payment initialised: order waits for payment, stock is held (not yet consumed).
    expect(placed.order).toMatchObject({
      needsPayment: true,
      paymentLabel: 'UPI',
      status: 'pending_payment',
    })
    expect(placed.payment).toMatchObject({
      amountPaise: 400_000,
      currency: 'INR',
      provider: 'razorpay',
    })
    expect(placed.payment?.clientKey).toBeTruthy()
    expect(await stockOf(h, product.variantId)).toEqual({ available: 3, onHand: 5, reserved: 2 })
    expect((await attemptsOf(h, placed.order.id)).map((a) => a.status)).toEqual(['pending'])

    // The app opens the (fixture) gateway, the customer pays, the app asks the server to verify.
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    const verified = (await app.verifyPayment({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    })) as { order: { status: string; paymentStatus: string }; verified: boolean }
    expect(verified).toMatchObject({
      order: { paymentStatus: 'paid', status: 'confirmed' },
      verified: true,
    })

    // Stock is consumed exactly once and the hold is closed.
    expect(await stockOf(h, product.variantId)).toEqual({ available: 3, onHand: 3, reserved: 0 })
    expect((await reservationsOf(h, placed.order.id)).map((r) => r.status)).toEqual(['committed'])
    expect((await movementsOf(h, product.variantId)).map((m) => m.quantityDelta)).toEqual([5, -2])
    expect((await attemptsOf(h, placed.order.id))[0]).toMatchObject({
      providerPaymentId: paid.razorpay_payment_id,
      status: 'paid',
    })

    // Verifying again, or the webhook arriving afterwards, changes nothing.
    await app.verifyPayment({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    })
    const body = h.gateway.webhookBody('payment.captured', paid.razorpay_payment_id)
    expect((await h.postWebhook(body)).status).toBe(200)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 3, onHand: 3, reserved: 0 })

    const order = await app.order(placed.order.id)
    expect(order).toMatchObject({ needsPayment: false, paymentStatus: 'paid', status: 'confirmed' })
    expect(
      (
        await h.payload.find({
          collection: 'order-status-events',
          depth: 0,
          limit: 50,
          overrideAccess: true,
          where: {
            and: [
              { order: { equals: Number(placed.order.id) } },
              { eventType: { equals: 'payment_verified' } },
            ],
          },
        })
      ).totalDocs,
    ).toBe(1)
  })

  it('rejects a forged signature, a wrong amount and another customer paying', async () => {
    const { app, placed, product } = await startOnlineOrder('b-forged')
    const paid = h.gateway.pay(placed.payment!.providerOrderId)

    const forged = await failure(
      app.verifyPayment({
        razorpayOrderId: paid.razorpay_order_id,
        razorpayPaymentId: paid.razorpay_payment_id,
        razorpaySignature: 'deadbeef',
      }),
    )
    expect(forged).toMatchObject({ code: 'INVALID_PAYMENT_SIGNATURE', status: 400 })

    const underpaid = h.gateway.pay(placed.payment!.providerOrderId, { amount: 1 })
    const mismatch = await failure(
      app.verifyPayment({
        razorpayOrderId: underpaid.razorpay_order_id,
        razorpayPaymentId: underpaid.razorpay_payment_id,
        razorpaySignature: underpaid.razorpay_signature,
      }),
    )
    expect(mismatch).toMatchObject({ code: 'PAYMENT_MISMATCH', status: 409 })

    const { app: other } = await newCustomer('b-forged-other', false)
    const stolen = await failure(
      other.verifyPayment({
        razorpayOrderId: paid.razorpay_order_id,
        razorpayPaymentId: paid.razorpay_payment_id,
        razorpaySignature: paid.razorpay_signature,
      }),
    )
    expect(stolen).toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND', status: 404 })

    expect(await rawOrder(h, placed.order.id)).toMatchObject({
      paymentStatus: 'pending',
      status: 'pending_payment',
    })
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 5, reserved: 1 })
  })

  it('processes webhooks once: duplicates, bad signatures and unknown orders', async () => {
    const { app, placed, product } = await startOnlineOrder('b-webhook')
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    const body = h.gateway.webhookBody('payment.captured', paid.razorpay_payment_id)

    expect((await h.postWebhook(body, { signature: 'bad' })).status).toBe(401)
    expect(await rawOrder(h, placed.order.id)).toMatchObject({ status: 'pending_payment' })

    const first = await h.postWebhook(body, { eventId: `evt_${runTag}_dup_${placed.order.id}` })
    expect(first.status).toBe(200)
    const second = await h.postWebhook(body, { eventId: `evt_${runTag}_dup_${placed.order.id}` })
    expect(second.status).toBe(200)
    expect(((await second.json()) as { data: { duplicate: boolean } }).data.duplicate).toBe(true)
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 4, reserved: 0 })
    expect((await app.order(placed.order.id)).status).toBe('confirmed')

    // A payment for an order we do not know must be acknowledged, not retried forever.
    h.gateway.orders.set('order_UNKNOWN', { amount: 100, currency: 'INR', receipt: 'x' })
    const stray = h.gateway.pay('order_UNKNOWN')
    const unknown = await h.postWebhook(
      h.gateway.webhookBody('payment.captured', stray.razorpay_payment_id),
    )
    expect(unknown.status).toBe(200)
  })

  it('does not hold a database transaction open while calling the gateway', async () => {
    const product = await h.catalog.product({ name: 'Pay b-outage', pricePaise: 100_000, stock: 3 })
    const { address, app } = await newCustomer('b-outage')
    await app.addToCart(product.variantId, 1, product.productId)
    h.gateway.failNextOrderCreation = true
    const key = idemKey('outage')
    const outage = await failure(
      app.placeOrder({ addressId: address!.id, paymentMethod: 'upi' }, key),
    )
    expect(outage.status).toBe(502)

    // The order exists with its stock held, flagged for reconciliation, and the app can recover.
    const [order] = (await app.orders()).filter((o) => o.paymentMethod === 'upi')
    expect(order).toBeDefined()
    const attempt = (await attemptsOf(h, order.id))[0]
    expect(attempt).toMatchObject({
      failureCode: 'GATEWAY_INITIALIZATION_UNCERTAIN',
      status: 'pending',
    })
    expect(await stockOf(h, product.variantId)).toMatchObject({ reserved: 1 })

    // Same key replays the same order instead of creating a second one.
    const replay = await app
      .placeOrder({ addressId: address!.id, paymentMethod: 'upi' }, key)
      .catch((error) => error)
    expect((await app.orders()).filter((o) => o.paymentMethod === 'upi')).toHaveLength(1)
    expect(replay).toBeDefined()
  })
})

describe('Flow C: failed and expired payments', () => {
  it('records a failed payment, keeps the hold and lets the customer retry successfully', async () => {
    const { app, placed, product } = await startOnlineOrder('c-retry')
    const failed = h.gateway.pay(placed.payment!.providerOrderId, { status: 'failed' })
    const webhook = await h.postWebhook(
      h.gateway.webhookBody('payment.failed', failed.razorpay_payment_id),
    )
    expect(webhook.status).toBe(200)
    expect((await attemptsOf(h, placed.order.id))[0].status).toBe('failed')
    expect(await rawOrder(h, placed.order.id)).toMatchObject({
      paymentStatus: 'failed',
      status: 'pending_payment',
    })
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 5, reserved: 1 })

    // The app can still offer "Pay now": a fresh gateway order is created.
    const retry = await app.retryPayment(placed.order.id)
    expect(retry.providerOrderId).not.toBe(placed.payment!.providerOrderId)
    const paid = h.gateway.pay(retry.providerOrderId)
    await app.verifyPayment({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    })
    expect(await app.order(placed.order.id)).toMatchObject({
      paymentStatus: 'paid',
      status: 'confirmed',
    })
    expect(await stockOf(h, product.variantId)).toEqual({ available: 4, onHand: 4, reserved: 0 })
    expect((await attemptsOf(h, placed.order.id)).map((a) => a.status)).toEqual(['failed', 'paid'])
  })

  it('releases the hold, cancels the order and frees the coupon when the hold expires', async () => {
    const coupon = await h.catalog.coupon({
      code: 'C-EXPIRE',
      discountValue: 10,
      minimumCartPaise: 0,
    })
    const product = await h.catalog.product({ name: 'Pay c-expire', pricePaise: 200_000, stock: 2 })
    const { address, app } = await newCustomer('c-expire')
    await app.addToCart(product.variantId, 2, product.productId)
    await app.applyCoupon(coupon.code)
    const placed = await app.placeOrder(
      { addressId: address!.id, couponCode: coupon.code, paymentMethod: 'upi' },
      idemKey('c-expire'),
    )
    expect(await stockOf(h, product.variantId)).toMatchObject({ available: 0, reserved: 2 })

    await h.expireHolds(placed.order.id)
    const token = await adminToken(h)
    const sweep = await h.rest('POST', '/admin/inventory-reservations/expire', { body: {}, token })
    expect(sweep.status).toBe(200)

    expect(await stockOf(h, product.variantId)).toEqual({ available: 2, onHand: 2, reserved: 0 })
    expect((await reservationsOf(h, placed.order.id)).map((r) => r.status)).toEqual(['expired'])
    const redemption = await h.payload.find({
      collection: 'coupon-redemptions',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { order: { equals: Number(placed.order.id) } },
    })
    expect(redemption.docs[0].status).toBe('released')

    // The customer must not be left with an order they can neither pay nor understand.
    const order = await app.order(placed.order.id)
    expect(order.status).toBe('cancelled')
    expect(order.needsPayment).toBe(false)
    const payAgain = await failure(app.retryPayment(placed.order.id))
    expect(payAgain.status).toBe(409)

    // The freed stock can be bought by someone else straight away.
    const { address: other, app: buyer } = await newCustomer('c-expire-buyer')
    await buyer.addToCart(product.variantId, 2, product.productId)
    const second = await buyer.placeOrder(
      { addressId: other!.id, paymentMethod: 'cod' },
      idemKey('c-expire-2'),
    )
    expect(second.order.status).toBe('confirmed')
  })

  it('flags a payment that arrives after the hold expired instead of confirming it silently', async () => {
    const { app, placed, product } = await startOnlineOrder('c-late', { stock: 1 })
    await h.expireHolds(placed.order.id)
    await h.rest('POST', '/admin/inventory-reservations/expire', {
      body: {},
      token: await adminToken(h),
    })
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    const webhook = await h.postWebhook(
      h.gateway.webhookBody('payment.captured', paid.razorpay_payment_id),
    )
    expect(webhook.status).toBe(200)

    const stored = await rawOrder(h, placed.order.id)
    expect(stored.paymentStatus).toBe('paid')
    expect(stored.exceptionCode).toBe('LATE_PAYMENT_REQUIRES_RECONCILIATION')
    expect(stored.status).not.toBe('confirmed')
    // Stock was never taken twice.
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 1, reserved: 0 })
    expect((await app.order(placed.order.id)).needsPayment).toBe(false)
  })

  it('verifies webhook signatures with the configured secret only', () => {
    const body = JSON.stringify({ event: 'payment.captured' })
    expect(GatewayFixture.sign(body)).not.toBe(GatewayFixture.sign(body, 'another-secret'))
  })
})

describe('Delayed payment reconciliation', () => {
  const backdate = async (orderId: string) => {
    const attempts = await attemptsOf(h, orderId)
    for (const attempt of attempts) {
      await h.payload.update({
        collection: 'payment-attempts',
        data: { initiatedAt: new Date(Date.now() - 10 * 60_000).toISOString() },
        id: attempt.id,
        overrideAccess: true,
      })
    }
  }

  it('settles a captured payment when neither the app callback nor the webhook arrived', async () => {
    const { app, placed, product } = await startOnlineOrder('r-lost', { qty: 1 })
    h.gateway.pay(placed.payment!.providerOrderId) // customer paid, then the app was killed
    expect((await app.order(placed.order.id)).status).toBe('pending_payment')

    await backdate(placed.order.id)
    const run = await h.rest('POST', '/admin/maintenance/run', {
      body: {},
      token: await adminToken(h),
    })
    expect(run.status).toBe(200)
    expect(await app.order(placed.order.id)).toMatchObject({
      paymentStatus: 'paid',
      status: 'confirmed',
    })
    expect(await stockOf(h, product.variantId)).toEqual({ available: 4, onHand: 4, reserved: 0 })

    // Running it again changes nothing.
    await h.rest('POST', '/admin/maintenance/run', { body: {}, token: await adminToken(h) })
    expect(await stockOf(h, product.variantId)).toEqual({ available: 4, onHand: 4, reserved: 0 })
  })

  it('leaves unpaid and recent attempts alone, and only staff can trigger it', async () => {
    const { app, placed, product } = await startOnlineOrder('r-unpaid')
    await backdate(placed.order.id)
    await h.rest('POST', '/admin/maintenance/run', { body: {}, token: await adminToken(h) })
    expect((await app.order(placed.order.id)).status).toBe('pending_payment')
    expect(await stockOf(h, product.variantId)).toMatchObject({ reserved: 1 })

    const fresh = await startOnlineOrder('r-fresh')
    h.gateway.pay(fresh.placed.payment!.providerOrderId)
    await h.rest('POST', '/admin/maintenance/run', { body: {}, token: await adminToken(h) })
    expect((await fresh.app.order(fresh.placed.order.id)).status).toBe('pending_payment')

    expect(
      (await h.rest('POST', '/admin/maintenance/run', { body: {}, token: app.token })).status,
    ).toBe(403)
    expect(
      (await h.rest('POST', '/admin/maintenance/run', { body: {} })).status,
    ).toBeGreaterThanOrEqual(401)
  })

  it('flags a lost payment that is only discovered after the order was cancelled', async () => {
    const { app, placed, product } = await startOnlineOrder('r-late', { stock: 1 })
    const paid = h.gateway.pay(placed.payment!.providerOrderId)
    expect(paid.razorpay_payment_id).toBeTruthy()
    await app.cancelOrder(placed.order.id)
    await backdate(placed.order.id)
    await h.rest('POST', '/admin/maintenance/run', { body: {}, token: await adminToken(h) })
    const stored = await rawOrder(h, placed.order.id)
    expect(stored.exceptionCode).toBe('LATE_PAYMENT_REQUIRES_RECONCILIATION')
    expect(stored.status).toBe('cancelled')
    expect(await stockOf(h, product.variantId)).toEqual({ available: 1, onHand: 1, reserved: 0 })
  })
})
