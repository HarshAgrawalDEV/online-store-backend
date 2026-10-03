import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { idemKey, newCustomer, stockOf } from './helpers'
import { failure, validAddress } from './mobile'

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

const setStatus = (collection: 'product-variants' | 'products', id: number, status: string) =>
  h.payload.update({ collection, data: { status } as never, id, overrideAccess: true })

describe('catalog as the mobile app sees it', () => {
  it('lists, filters, sorts and paginates', async () => {
    const cheap = await h.catalog.product({ name: 'Cat zeta cheap', pricePaise: 50_000, stock: 5 })
    const mid = await h.catalog.product({ name: 'Cat zeta mid', pricePaise: 150_000, stock: 5 })
    await h.catalog.product({ name: 'Cat zeta rich', pricePaise: 450_000, stock: 0 })
    const { app } = await newCustomer('cat-browse', false)

    const byPriceLow = await app.products({ search: 'Cat zeta', sort: 'price-low' })
    expect(byPriceLow.map((p) => p.price)).toEqual([50_000, 150_000, 450_000])
    const byPriceHigh = await app.products({ search: 'Cat zeta', sort: 'price-high' })
    expect(byPriceHigh[0].price).toBe(450_000)

    const raw = await h.rest(
      'GET',
      '/catalog/products?search=Cat%20zeta&minPrice=100000&maxPrice=200000',
    )
    expect(((await raw.json()) as { docs: { id: number }[] }).docs.map((d) => d.id)).toEqual([
      mid.productId,
    ])
    const inStock = await h.rest('GET', '/catalog/products?search=Cat%20zeta&available=true')
    expect(
      ((await inStock.json()) as { docs: { id: number }[] }).docs.map((d) => d.id).sort(),
    ).toEqual([cheap.productId, mid.productId].sort())

    const soldOut = (await app.products({ search: 'Cat zeta rich' }))[0]
    expect(soldOut).toMatchObject({ available: false })
    expect(soldOut.variants[0]).toMatchObject({ available: false, quantity: 0 })

    const page1 = (await (
      await h.rest('GET', '/catalog/products?search=Cat%20zeta&limit=2&page=1&sort=name')
    ).json()) as { docs: unknown[]; hasNextPage: boolean; totalDocs: number }
    const page2 = (await (
      await h.rest('GET', '/catalog/products?search=Cat%20zeta&limit=2&page=2&sort=name')
    ).json()) as { docs: unknown[]; hasNextPage: boolean }
    expect(page1).toMatchObject({ hasNextPage: true, totalDocs: 3 })
    expect(page1.docs).toHaveLength(2)
    expect(page2).toMatchObject({ hasNextPage: false })
    expect(page2.docs).toHaveLength(1)
  })

  it('hides unpublished products, their variants and supplier costs from everyone but staff', async () => {
    const live = await h.catalog.product({ name: 'Vis live item', pricePaise: 100_000, stock: 3 })
    const hidden = await h.catalog.product({
      name: 'Vis hidden item',
      pricePaise: 100_000,
      stock: 3,
    })
    await h.payload.update({
      collection: 'product-variants',
      data: { costPaise: 40_000 },
      id: hidden.variantId,
      overrideAccess: true,
    })
    await h.payload.update({
      collection: 'product-variants',
      data: { costPaise: 40_000 },
      id: live.variantId,
      overrideAccess: true,
    })
    await setStatus('products', hidden.productId, 'draft')
    const { app } = await newCustomer('vis', false)

    for (const token of [undefined, app.token]) {
      const list = JSON.stringify(
        await (await h.rest('GET', '/catalog/products?search=Vis%20', { token })).json(),
      )
      expect(list).toContain('Vis live item')
      expect(list).not.toContain('Vis hidden item')
      expect(list).not.toContain('costPaise')
      expect((await h.rest('GET', `/catalog/products/${hidden.productId}`, { token })).status).toBe(
        404,
      )
      expect((await h.rest('GET', `/catalog/products/${live.productId}`, { token })).status).toBe(
        200,
      )

      const built = await h.rest('GET', `/products?where[name][like]=Vis&depth=0`, { token })
      expect(JSON.stringify(await built.json())).not.toContain('Vis hidden item')
      const variants = (await (
        await h.rest('GET', `/product-variants?limit=100&depth=0`, { token })
      ).json()) as { docs: { id: number }[] }
      expect(variants.docs.map((v) => v.id)).toContain(live.variantId)
      expect(variants.docs.map((v) => v.id)).not.toContain(hidden.variantId)
      expect(JSON.stringify(variants)).not.toContain('costPaise')
      expect(
        (await h.rest('GET', `/product-variants/${hidden.variantId}`, { token })).status,
      ).toBeGreaterThanOrEqual(403)
    }
    // Staff still see the draft.
    expect(
      await h.payload.findByID({
        collection: 'products',
        id: hidden.productId,
        overrideAccess: true,
      }),
    ).toMatchObject({ status: 'draft' })
  })

  it('does not list inactive variants and reports stock per variant', async () => {
    const product = await h.catalog.product({
      name: 'Var active item',
      pricePaise: 100_000,
      stock: 2,
    })
    const second = await h.payload.create({
      collection: 'product-variants',
      data: {
        colorCode: 'ruby-red',
        optionSignature: `free-size|ruby-red|${product.sku}`,
        pricePaise: 120_000,
        product: product.productId,
        sizeCode: 'free-size',
        sku: `${product.sku}-B`,
        status: 'inactive',
      } as never,
      overrideAccess: true,
    })
    const { app } = await newCustomer('var', false)
    const detail = await app.product(product.productId)
    expect(detail.variants.map((v) => v.id)).toEqual([String(product.variantId)])
    expect(detail.variants.map((v) => v.id)).not.toContain(String(second.id))
    await h.payload.delete({ collection: 'product-variants', id: second.id, overrideAccess: true })
  })
})

describe('cart rules', () => {
  it('enforces quantity limits and variant availability with clear errors', async () => {
    const product = await h.catalog.product({
      name: 'Cart limits',
      pricePaise: 100_000,
      stock: 4,
      maxPerOrder: 3,
    })
    const { app } = await newCustomer('cart-limits', false)

    expect(await failure(app.addToCart(product.variantId, 4))).toMatchObject({
      code: 'MAX_QUANTITY_EXCEEDED',
      status: 422,
    })
    await app.addToCart(product.variantId, 3)
    expect(await failure(app.addToCart(product.variantId, 1))).toMatchObject({
      code: 'MAX_QUANTITY_EXCEEDED',
      status: 422,
    })
    const cart = await app.cart()
    expect(await failure(app.setQuantity(cart.lines[0].id, 4))).toMatchObject({ status: 422 })
    for (const bad of [0, -1, 1.5, 'x']) {
      const response = await h.rest('POST', '/cart/items', {
        body: { quantity: bad, variantId: product.variantId },
        token: app.token,
      })
      expect(response.status, String(bad)).toBe(400)
    }
    expect((await failure(app.addToCart(999_999_999, 1))).status).toBeGreaterThanOrEqual(400)

    const low = await h.catalog.product({
      name: 'Cart low stock',
      pricePaise: 100_000,
      stock: 2,
      maxPerOrder: 5,
    })
    expect(await failure(app.addToCart(low.variantId, 3))).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 422,
    })
    const empty = await h.catalog.product({ name: 'Cart no stock', pricePaise: 100_000, stock: 0 })
    expect(await failure(app.addToCart(empty.variantId, 1))).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    })
  })

  it('rejects variants that are inactive or whose product is unpublished', async () => {
    const product = await h.catalog.product({
      name: 'Cart unpublished',
      pricePaise: 100_000,
      stock: 4,
    })
    // Staff cannot deactivate a product last active variant, so keep a second one active.
    const spare = await h.payload.create({
      collection: 'product-variants',
      data: {
        colorCode: 'ruby-red',
        optionSignature: `free-size|ruby-red|${product.sku}`,
        pricePaise: 100_000,
        product: product.productId,
        sizeCode: 'free-size',
        sku: `${product.sku}-SPARE`,
        status: 'active',
      } as never,
      overrideAccess: true,
    })
    const { app } = await newCustomer('cart-unpub', false)
    await setStatus('product-variants', product.variantId, 'inactive')
    expect(await failure(app.addToCart(product.variantId, 1))).toMatchObject({
      code: 'UNAVAILABLE_VARIANT',
      status: 422,
    })
    await setStatus('product-variants', product.variantId, 'active')
    await setStatus('products', product.productId, 'draft')
    expect(await failure(app.addToCart(product.variantId, 1))).toMatchObject({
      code: 'UNAVAILABLE_PRODUCT',
      status: 422,
    })
    await setStatus('products', product.productId, 'active')
    await h.payload.delete({ collection: 'product-variants', id: spare.id, overrideAccess: true })
  })

  it('reprices from the server when staff change a price, and blocks unavailable lines at checkout', async () => {
    const product = await h.catalog.product({
      name: 'Cart repriced',
      pricePaise: 100_000,
      stock: 5,
    })
    const { address, app } = await newCustomer('cart-reprice')
    await app.addToCart(product.variantId, 2)
    await h.payload.update({
      collection: 'product-variants',
      data: { pricePaise: 120_000 },
      id: product.variantId,
      overrideAccess: true,
    })
    expect(await app.cart()).toMatchObject({ subtotal: 240_000, total: 240_000 })
    expect((await app.preview({ addressId: address!.id, paymentMethod: 'cod' })).total).toBe(
      240_000,
    )

    await setStatus('products', product.productId, 'draft')
    const cart = await app.cart()
    expect(cart.lines[0].valid).toBe(false)
    expect(
      await failure(app.preview({ addressId: address!.id, paymentMethod: 'cod' })),
    ).toMatchObject({ code: 'UNAVAILABLE_ITEM', status: 422 })
    // The customer can clear it out and carry on.
    expect((await app.removeItem(cart.lines[0].id)).count).toBe(0)
  })

  it('consolidates repeated adds and supports remove and clear', async () => {
    const product = await h.catalog.product({ name: 'Cart merge', pricePaise: 100_000, stock: 9 })
    const other = await h.catalog.product({ name: 'Cart merge two', pricePaise: 50_000, stock: 9 })
    const { app } = await newCustomer('cart-merge', false)
    await app.addToCart(product.variantId, 1)
    await app.addToCart(product.variantId, 2)
    const cart = await app.addToCart(other.variantId, 1)
    expect(cart.lines.map((l) => l.quantity)).toEqual([3, 1])
    expect(cart).toMatchObject({ count: 4, subtotal: 350_000 })
    expect((await app.removeItem(cart.lines[1].id)).lines).toHaveLength(1)
    const cleared = (await h
      .rest('DELETE', '/cart', { token: app.token })
      .then((r) => r.json())) as { data: { lines: unknown[] } }
    expect(cleared.data.lines).toHaveLength(0)
  })
})

describe('coupons', () => {
  const cartWith = async (name: string, price = 100_000, qty = 2) => {
    const product = await h.catalog.product({
      name: `Coupon ${name}`,
      pricePaise: price,
      stock: 20,
    })
    const shopper = await newCustomer(`coupon-${name}`)
    await shopper.app.addToCart(product.variantId, qty, product.productId)
    return { ...shopper, product }
  }

  it('applies percentage (with cap) and fixed discounts, never below zero', async () => {
    const pct = await h.catalog.coupon({
      code: 'PCT20',
      discountType: 'percentage',
      discountValue: 20,
      maxDiscountPaise: 30_000,
    })
    const fixed = await h.catalog.coupon({
      code: 'FIX',
      discountType: 'fixed',
      discountValue: 500_000,
    })
    const { app } = await cartWith('math') // subtotal 200,000
    expect(await app.applyCoupon(pct.code)).toMatchObject({ discount: 30_000, total: 170_000 })
    const huge = await app.applyCoupon(fixed.code)
    expect(huge.discount).toBeLessThanOrEqual(200_000)
    expect(huge.total).toBeGreaterThanOrEqual(0)
    expect(await app.removeCoupon()).toMatchObject({ discount: 0, total: 200_000 })
  })

  it('refuses invalid, expired, disabled, below-minimum and unknown coupons', async () => {
    const expired = await h.catalog.coupon({ code: 'OLD', discountValue: 10 })
    await h.payload.update({
      collection: 'coupons',
      data: { endsAt: new Date(Date.now() - 86_400_000).toISOString() },
      id: expired.id,
      overrideAccess: true,
    })
    const future = await h.catalog.coupon({ code: 'SOON', discountValue: 10 })
    await h.payload.update({
      collection: 'coupons',
      data: { startsAt: new Date(Date.now() + 86_400_000).toISOString() },
      id: future.id,
      overrideAccess: true,
    })
    const disabled = await h.catalog.coupon({ code: 'OFF', discountValue: 10 })
    await h.payload.update({
      collection: 'coupons',
      data: { status: 'disabled' },
      id: disabled.id,
      overrideAccess: true,
    })
    const minimum = await h.catalog.coupon({
      code: 'MIN',
      discountValue: 10,
      minimumCartPaise: 1_000_000,
    })
    const { app } = await cartWith('refuse')

    expect(await failure(app.applyCoupon('NOPE-NOT-A-CODE'))).toMatchObject({
      code: 'INVALID_COUPON',
      status: 422,
    })
    expect(await failure(app.applyCoupon(expired.code))).toMatchObject({
      code: 'COUPON_EXPIRED',
      status: 422,
    })
    expect(await failure(app.applyCoupon(future.code))).toMatchObject({
      code: 'COUPON_EXPIRED',
      status: 422,
    })
    expect(await failure(app.applyCoupon(disabled.code))).toMatchObject({
      code: 'INVALID_COUPON',
      status: 422,
    })
    expect(await failure(app.applyCoupon(minimum.code))).toMatchObject({
      code: 'MINIMUM_CART_NOT_MET',
      status: 422,
    })
    expect((await app.cart()).couponCode).toBeUndefined()
  })

  it('does not apply a coupon whose promotion covers none of the cart', async () => {
    const other = await h.catalog.product({
      name: 'Coupon other item',
      pricePaise: 100_000,
      stock: 5,
    })
    const coupon = await h.catalog.coupon({ code: 'ONLYOTHER', discountValue: 10 })
    const stored = await h.payload.findByID({
      collection: 'coupons',
      depth: 0,
      id: coupon.id,
      overrideAccess: true,
    })
    await h.payload.update({
      collection: 'promotions',
      data: { applicableProducts: [other.productId] } as never,
      id: Number(stored.promotion),
      overrideAccess: true,
    })
    const { app } = await cartWith('scope')
    const result = await failure(app.applyCoupon(coupon.code))
    expect(result).toMatchObject({ code: 'INELIGIBLE_COUPON', status: 422 })
    expect((await app.cart()).couponCode).toBeUndefined()
  })

  it('enforces per-customer and global limits when applying, not only at purchase', async () => {
    const once = await h.catalog.coupon({ code: 'PERCUST', discountValue: 10, perCustomerLimit: 1 })
    const { address, app, product } = await cartWith('limits')
    await app.applyCoupon(once.code)
    const placed = await app.placeOrder(
      { addressId: address!.id, couponCode: once.code, paymentMethod: 'cod' },
      idemKey('once'),
    )
    expect(placed.order.totals.discount).toBeGreaterThan(0)

    await app.addToCart(product.variantId, 1, product.productId)
    const again = await failure(app.applyCoupon(once.code))
    expect(again.status).toBe(422)
    expect(again.code).toMatch(/COUPON_(LIMIT|CUSTOMER_LIMIT)_REACHED/)

    const global = await h.catalog.coupon({
      code: 'GLOBAL1',
      discountValue: 10,
      usageLimit: 1,
      perCustomerLimit: 5,
    })
    const first = await cartWith('global-a')
    await first.app.applyCoupon(global.code)
    await first.app.placeOrder(
      { addressId: first.address!.id, couponCode: global.code, paymentMethod: 'cod' },
      idemKey('g1'),
    )
    const second = await cartWith('global-b')
    const blocked = await failure(second.app.applyCoupon(global.code))
    expect(blocked.status).toBe(422)
    expect(blocked.code).toMatch(/COUPON_(LIMIT|CUSTOMER_LIMIT)_REACHED/)
  })

  it('keeps order totals reconciled when a coupon discount is split across lines', async () => {
    const a = await h.catalog.product({ name: 'Coupon split A', pricePaise: 33_333, stock: 9 })
    const b = await h.catalog.product({ name: 'Coupon split B', pricePaise: 66_667, stock: 9 })
    const coupon = await h.catalog.coupon({ code: 'SPLIT7', discountValue: 7 })
    const { address, app } = await newCustomer('coupon-split')
    await app.addToCart(a.variantId, 3, a.productId)
    await app.addToCart(b.variantId, 1, b.productId)
    await app.applyCoupon(coupon.code)
    const placed = await app.placeOrder(
      { addressId: address!.id, couponCode: coupon.code, paymentMethod: 'cod' },
      idemKey('split'),
    )
    const lineTotals = placed.order.lines.reduce((sum, line) => sum + line.lineTotal, 0)
    expect(lineTotals).toBe(placed.order.totals.subtotal - placed.order.totals.discount)
    expect(placed.order.totals.total).toBe(
      lineTotals +
        placed.order.totals.shipping +
        placed.order.totals.codFee +
        placed.order.totals.tax,
    )
    expect(await stockOf(h, a.variantId)).toMatchObject({ onHand: 6 })
  })
})

describe('wishlist and addresses (mobile services)', () => {
  it('keeps one wishlist row per product and returns only allow-listed fields', async () => {
    const product = await h.catalog.product({ name: 'Wish item', pricePaise: 100_000, stock: 2 })
    await h.payload.update({
      collection: 'product-variants',
      data: { costPaise: 12_345 },
      id: product.variantId,
      overrideAccess: true,
    })
    const { app } = await newCustomer('wish', false)
    await app.addToWishlist(product.productId)
    await app.addToWishlist(product.productId)
    expect(await app.wishlistIds()).toEqual([String(product.productId)])
    const raw = JSON.stringify(await app.wishlistRaw())
    for (const leak of ['costPaise', '12345', 'sku', 'hsnCode']) expect(raw).not.toContain(leak)
    expect(raw).toContain('Wish item')
    await setStatus('products', product.productId, 'draft')
    expect(await app.wishlistIds()).toEqual([])
    expect((await failure(app.addToWishlist(999_999_999))).status).toBe(404)
    await setStatus('products', product.productId, 'active')
    await app.removeFromWishlist(product.productId)
    expect(await app.wishlistIds()).toEqual([])
  })

  it('maintains exactly one default address and supports edit and delete', async () => {
    const { app } = await newCustomer('addr', false)
    const first = await app.addAddress()
    const second = await app.addAddress({ ...validAddress, city: 'Udaipur', isDefault: true })
    let list = await app.addresses()
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id])
    await app.setDefaultAddress(first.id)
    list = await app.addresses()
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([first.id])
    const edited = await app.updateAddress(first.id, { city: 'Jodhpur', landmark: 'Clock Tower' })
    expect(edited).toMatchObject({ city: 'Jodhpur', landmark: 'Clock Tower' })
    await app.removeAddress(second.id)
    expect((await app.addresses()).map((a) => a.id)).toEqual([first.id])
    expect((await failure(app.removeAddress(second.id))).status).toBe(404)
  })

  it('keeps old orders readable after the address they used is deleted', async () => {
    const product = await h.catalog.product({
      name: 'Addr snapshot item',
      pricePaise: 100_000,
      stock: 3,
    })
    const { address, app } = await newCustomer('addr-snap')
    await app.addToCart(product.variantId, 1, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('snap'),
    )
    await app.updateAddress(address!.id, { city: 'Changed Later', line1: '99 New Street' })
    const order = await app.order(placed.order.id)
    expect(order.address).toMatchObject({ city: 'Jaipur', line1: '12 MI Road' })
    await app.addAddress()
    await app.removeAddress(address!.id)
    expect((await app.order(placed.order.id)).address).toMatchObject({ city: 'Jaipur' })
  })
})
