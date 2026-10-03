import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { adminToken, idemKey, movementsOf, newCustomer, stockOf } from './helpers'

let h: Harness
let token: string
beforeAll(async () => {
  h = await startHarness()
  token = await adminToken(h)
})
afterAll(async () => {
  await h?.cleanup()
})

const adjust = (body: Record<string, unknown>) =>
  h.rest('POST', '/admin/inventory/adjust', { body, token })

describe('mobile taps that race each other', () => {
  it('six rapid "Add to bag" taps all count and never error', async () => {
    const product = await h.catalog.product({
      name: 'X rapid add',
      pricePaise: 100_000,
      stock: 20,
      maxPerOrder: 10,
    })
    const { app } = await newCustomer('x-add', false)
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => app.addToCart(product.variantId, 1, product.productId)),
    )
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => (r as PromiseRejectedResult).reason?.status),
    ).toEqual([])
    const cart = await app.cart()
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0].quantity).toBe(6)
  })

  it('a brand-new customer opening several screens at once gets one cart', async () => {
    const { app } = await newCustomer('x-first-cart', false)
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => h.rest('GET', '/cart', { token: app.token })),
    )
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    const carts = await h.payload.find({
      collection: 'carts',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: {
        and: [{ customer: { equals: Number(app.profile!.id) } }, { status: { equals: 'active' } }],
      },
    })
    expect(carts.totalDocs).toBe(1)
  })

  it('a double-tapped heart saves the product once without an error', async () => {
    const product = await h.catalog.product({ name: 'X rapid wish', pricePaise: 100_000, stock: 3 })
    const { app } = await newCustomer('x-wish', false)
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => app.addToWishlist(product.productId)),
    )
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    expect(await app.wishlistIds()).toEqual([String(product.productId)])
  })
})

describe('staff stock adjustments', () => {
  it('concurrent adjustments all apply and the history adds up', async () => {
    const product = await h.catalog.product({
      name: 'X adjust race',
      pricePaise: 100_000,
      stock: 10,
    })
    const responses = await Promise.all([
      adjust({ note: 'a', quantityDelta: 5, variantId: product.variantId }),
      adjust({ note: 'b', quantityDelta: 7, variantId: product.variantId }),
      adjust({ note: 'c', quantityDelta: -3, variantId: product.variantId }),
    ])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect((await stockOf(h, product.variantId)).onHand).toBe(19)
    const movements = await movementsOf(h, product.variantId)
    expect(movements.reduce((sum, m) => sum + Number(m.quantityDelta), 0)).toBe(19)
    expect(movements.map((m) => m.quantityDelta).sort((a, b) => a - b)).toEqual([-3, 5, 7, 10])
  })

  it('two large removals cannot drive stock negative', async () => {
    const product = await h.catalog.product({
      name: 'X adjust floor',
      pricePaise: 100_000,
      stock: 10,
    })
    const responses = await Promise.all([
      adjust({ quantityDelta: -8, reason: 'damage', variantId: product.variantId }),
      adjust({ quantityDelta: -8, reason: 'damage', variantId: product.variantId }),
    ])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
    expect((await stockOf(h, product.variantId)).onHand).toBe(2)
  })

  it('a retried request with the same operation id applies once', async () => {
    const product = await h.catalog.product({
      name: 'X adjust idem',
      pricePaise: 100_000,
      stock: 4,
    })
    const operationId = `op-${product.variantId}-${Date.now()}`
    const first = await adjust({ operationId, quantityDelta: 6, variantId: product.variantId })
    const retry = await adjust({ operationId, quantityDelta: 6, variantId: product.variantId })
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect((await stockOf(h, product.variantId)).onHand).toBe(10)
    expect(
      (await movementsOf(h, product.variantId)).filter((m) => m.referenceId === operationId),
    ).toHaveLength(1)
    const reused = await adjust({ operationId, quantityDelta: 1, variantId: product.variantId })
    expect(reused.status).toBe(409)
  })

  it('cannot remove stock that is reserved for a pending order', async () => {
    const product = await h.catalog.product({
      name: 'X adjust reserved',
      pricePaise: 100_000,
      stock: 3,
    })
    const { address, app } = await newCustomer('x-reserved')
    await app.addToCart(product.variantId, 2, product.productId)
    await app.placeOrder({ addressId: address!.id, paymentMethod: 'upi' }, idemKey('x-reserved'))
    const response = await adjust({
      quantityDelta: -2,
      reason: 'damage',
      variantId: product.variantId,
    })
    expect(response.status).toBe(400)
    expect(await stockOf(h, product.variantId)).toMatchObject({ onHand: 3, reserved: 2 })
    expect(
      (await adjust({ quantityDelta: -1, reason: 'damage', variantId: product.variantId })).status,
    ).toBe(200)
  })

  it('records who made the adjustment and keeps staff-only access', async () => {
    const product = await h.catalog.product({
      name: 'X adjust audit',
      pricePaise: 100_000,
      stock: 1,
    })
    await adjust({ note: 'recount', quantityDelta: 2, variantId: product.variantId })
    const movement = (await movementsOf(h, product.variantId)).find((m) => m.note === 'recount')
    expect(movement).toMatchObject({ quantityDelta: 2, reason: 'manual_adjustment' })
    expect(movement?.performedBy).toBe(h.admin.id)
    const { app } = await newCustomer('x-audit', false)
    expect(
      (
        await h.rest('POST', '/admin/inventory/adjust', {
          body: { quantityDelta: 1, variantId: product.variantId },
          token: app.token,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await h.rest('POST', '/admin/inventory/adjust', {
          body: { quantityDelta: 1, variantId: product.variantId },
        })
      ).status,
    ).toBe(401)
  })
})
