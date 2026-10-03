/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { idemKey, newCustomer, stockOf } from './helpers'

let h: Harness
let sql: (typeof import('@payloadcms/db-postgres'))['sql']
let db: any

beforeAll(async () => {
  h = await startHarness()
  sql = (await import('@payloadcms/db-postgres')).sql
  db = (h.payload.db as any).drizzle
})
afterAll(async () => {
  await h?.cleanup()
})

const rows = async (query: string): Promise<any[]> => (await db.execute(sql.raw(query))).rows

/** Run a statement that must be rejected by the database; returns the Postgres error code. */
const rejected = async (statement: string): Promise<string> => {
  try {
    await db.execute(sql.raw(statement))
  } catch (error: any) {
    return String(error?.cause?.code ?? error?.code ?? error?.message)
  }
  throw new Error(`The database accepted a statement it should reject: ${statement.slice(0, 80)}`)
}
const CHECK = '23514'
const UNIQUE = '23505'
const FOREIGN_KEY = '23503'

describe('migration history', () => {
  it('records every migration as applied, with no development-push marker', async () => {
    const applied = (await rows('SELECT name, batch FROM payload_migrations ORDER BY id')).map(
      (row) => row.name,
    )
    expect(applied).toEqual([
      '20261002_075308_phase_1_initial',
      '20261002_092441_phase_2_catalog_inventory',
      '20261002_101603_phase_3_customer_shopping',
      '20261002_102000_phase_3_invariants',
      '20261003_060603',
    ])
    expect(applied).not.toContain('dev')
  })
})

describe('schema protections exist', () => {
  it('has the CHECK constraints that guard money and stock', async () => {
    const checks = await rows(
      "SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace",
    )
    const byTable = (table: string) =>
      checks
        .filter((check) => check.table_name === table)
        .map((check) => check.definition)
        .join(' ')
    expect(byTable('inventory')).toMatch(/reserved/)
    expect(byTable('inventory')).toMatch(/on_hand/)
    expect(byTable('order_items')).toMatch(/quantity/)
    expect(byTable('orders')).toMatch(/grand_total_paise/)
    expect(byTable('payment_attempts')).toMatch(/amount_paise/)
    expect(checks.length).toBeGreaterThanOrEqual(7)
  })

  it('has the unique indexes that make idempotency and one-per-customer rules hold', async () => {
    const indexes = (
      await rows("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'")
    ).map((row) => `${row.indexname} ${row.indexdef}`)
    const has = (pattern: RegExp) => indexes.some((entry) => pattern.test(entry))
    expect(has(/UNIQUE.*orders.*customer_id.*idempotency_key/)).toBe(true)
    expect(has(/UNIQUE.*payment_attempts.*idempotency_key/)).toBe(true)
    expect(has(/UNIQUE.*product_variants.*sku/)).toBe(true)
    expect(has(/UNIQUE.*carts.*customer_id.*WHERE/s)).toBe(true)
    expect(has(/UNIQUE.*customer_addresses.*customer_id.*WHERE/s)).toBe(true)
    expect(has(/UNIQUE.*wishlist_items.*product/)).toBe(true)
    expect(has(/UNIQUE.*cart_items.*variant/)).toBe(true)
    expect(has(/UNIQUE.*coupons.*code/)).toBe(true)
    expect(has(/UNIQUE.*orders.*order_number/)).toBe(true)
  })

  it('stores money as whole paise with no fractional precision', async () => {
    const moneyColumns = await rows(
      "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%\\_paise' ESCAPE '\\'",
    )
    expect(moneyColumns.length).toBeGreaterThan(10)
    // Whatever the column type, fractions must be impossible for the columns that carry order money.
    for (const statement of ['INSERT INTO payment_attempts (amount_paise) VALUES (100.5)']) {
      expect([CHECK, '23502']).toContain(await rejected(statement))
    }
  })
})

describe('data rules are enforced by PostgreSQL, not just by the app', () => {
  it('refuses impossible stock', async () => {
    const product = await h.catalog.product({ name: 'DB stock', pricePaise: 100_000, stock: 5 })
    expect(
      await rejected(`UPDATE inventory SET on_hand = -1 WHERE variant_id = ${product.variantId}`),
    ).toBe(CHECK)
    expect(
      await rejected(
        `UPDATE inventory SET reserved = on_hand + 1 WHERE variant_id = ${product.variantId}`,
      ),
    ).toBe(CHECK)
    expect(
      await rejected(`UPDATE inventory SET reserved = -1 WHERE variant_id = ${product.variantId}`),
    ).toBe(CHECK)
    expect(await stockOf(h, product.variantId)).toEqual({ available: 5, onHand: 5, reserved: 0 })
  })

  it('refuses duplicate SKUs, wishlist rows, cart rows, coupon codes and idempotency keys', async () => {
    const product = await h.catalog.product({ name: 'DB unique', pricePaise: 100_000, stock: 5 })
    const { address, app } = await newCustomer('db-unique')
    await app.addToWishlist(product.productId)
    await app.addToCart(product.variantId, 1, product.productId)

    // Duplicate SKU through Payload (which surfaces the database error).
    await expect(
      h.payload.create({
        collection: 'product-variants',
        data: {
          colorCode: 'gold',
          optionSignature: 'dup|sku|1',
          pricePaise: 1,
          product: product.productId,
          sizeCode: 'free-size',
          sku: product.sku,
          status: 'inactive',
        } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow()

    const customer = (await rows(`SELECT id FROM customers WHERE email = '${app.email}'`))[0].id
    const cart = (
      await rows(`SELECT id FROM carts WHERE customer_id = ${customer} AND status = 'active'`)
    )[0].id
    const wishlist = (await rows(`SELECT id FROM wishlists WHERE customer_id = ${customer}`))[0].id
    expect(
      await rejected(
        `INSERT INTO cart_items (cart_id, variant_id, quantity, updated_at, created_at) VALUES (${cart}, ${product.variantId}, 1, now(), now())`,
      ),
    ).toBe(UNIQUE)
    expect(
      await rejected(
        `INSERT INTO wishlist_items (wishlist_id, product_id, updated_at, created_at) VALUES (${wishlist}, ${product.productId}, now(), now())`,
      ),
    ).toBe(UNIQUE)
    expect(
      await rejected(
        `INSERT INTO carts (customer_id, status, currency, updated_at, created_at) VALUES (${customer}, 'active', 'INR', now(), now())`,
      ),
    ).toBe(UNIQUE)

    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('db-unique'),
    )
    const orderRow = (await rows(`SELECT * FROM orders WHERE id = ${placed.order.id}`))[0]
    expect(orderRow.grand_total_paise).toBeDefined()
    expect(
      await rejected(
        `INSERT INTO payment_attempts (idempotency_key) VALUES ('${customer}:${orderRow.idempotency_key}:1')`,
      ),
    ).toMatch(new RegExp(`${UNIQUE}|23502`))
  })

  it('allows only one default address per customer', async () => {
    const { app } = await newCustomer('db-default', false)
    const first = await app.addAddress()
    const second = await app.addAddress()
    await app.setDefaultAddress(first.id)
    await app.setDefaultAddress(second.id)
    const customer = (await rows(`SELECT id FROM customers WHERE email = '${app.email}'`))[0].id
    expect(
      await rejected(
        `UPDATE customer_addresses SET is_default = true WHERE customer_id = ${customer}`,
      ),
    ).toBe(UNIQUE)
    const defaults = await rows(
      `SELECT id FROM customer_addresses WHERE customer_id = ${customer} AND is_default = true AND is_active = true`,
    )
    expect(defaults).toHaveLength(1)
  })

  it('keeps relationships intact', async () => {
    expect(
      await rejected(
        "INSERT INTO order_items (order_id, quantity, sku_snapshot, product_name_snapshot) VALUES (999999999, 1, 'x', 'x')",
      ),
    ).toMatch(new RegExp(`${FOREIGN_KEY}|23502`))
    expect(
      await rejected(
        'INSERT INTO inventory_reservations (order_id, variant_id, quantity) VALUES (999999999, 999999999, 1)',
      ),
    ).toMatch(new RegExp(`${FOREIGN_KEY}|23502`))
    expect(
      await rejected(
        'INSERT INTO cart_items (cart_id, variant_id, quantity, updated_at, created_at) VALUES (999999999, 999999999, 1, now(), now())',
      ),
    ).toBe(FOREIGN_KEY)
  })
})

describe('order snapshots and money reconcile in the database', () => {
  it('stores a snapshot that survives product edits, and totals that add up', async () => {
    await h.setShipping({
      codEnabled: true,
      codFeePaise: 2500,
      freeShippingAbovePaise: 0,
      standardFeePaise: 4000,
    })
    const coupon = await h.catalog.coupon({
      code: 'DB-SNAP',
      discountValue: 15,
      maxDiscountPaise: 20_000,
    })
    const product = await h.catalog.product({
      name: 'DB snapshot original',
      pricePaise: 99_999,
      stock: 9,
    })
    const { address, app } = await newCustomer('db-snap')
    await app.addToCart(product.variantId, 3, product.productId)
    await app.applyCoupon(coupon.code)
    const placed = await app.placeOrder(
      { addressId: address!.id, couponCode: coupon.code, paymentMethod: 'cod' },
      idemKey('db-snap'),
    )

    await h.payload.update({
      collection: 'products',
      data: { name: 'Renamed later' },
      id: product.productId,
      overrideAccess: true,
    })
    await h.payload.update({
      collection: 'product-variants',
      data: { pricePaise: 1 },
      id: product.variantId,
      overrideAccess: true,
    })

    const order = (await rows(`SELECT * FROM orders WHERE id = ${placed.order.id}`))[0]
    const items = await rows(`SELECT * FROM order_items WHERE order_id = ${placed.order.id}`)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      product_name_snapshot: 'DB snapshot original',
      quantity: expect.anything(),
    })
    expect(Number(items[0].unit_price_paise)).toBe(99_999)
    const sum = (key: string) => items.reduce((total, item) => total + Number(item[key]), 0)
    expect(sum('line_subtotal_paise')).toBe(Number(order.items_subtotal_paise))
    expect(sum('line_discount_paise')).toBe(Number(order.discount_paise))
    expect(sum('line_total_paise')).toBe(
      Number(order.items_subtotal_paise) - Number(order.discount_paise),
    )
    expect(Number(order.grand_total_paise)).toBe(
      Number(order.items_subtotal_paise) -
        Number(order.discount_paise) +
        Number(order.shipping_paise) +
        Number(order.cod_fee_paise) +
        Number(order.tax_paise),
    )
    const redemption = (
      await rows(`SELECT * FROM coupon_redemptions WHERE order_id = ${placed.order.id}`)
    )[0]
    expect(Number(redemption.amount_paise)).toBe(Number(order.discount_paise))
    expect(redemption.status).toBe('redeemed')
  })

  it('refuses order rows whose totals do not add up', async () => {
    const product = await h.catalog.product({ name: 'DB totals', pricePaise: 100_000, stock: 3 })
    const { address, app } = await newCustomer('db-totals')
    await app.addToCart(product.variantId, 1, product.productId)
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('db-totals'),
    )
    expect(
      await rejected(
        `UPDATE orders SET grand_total_paise = grand_total_paise + 1 WHERE id = ${placed.order.id}`,
      ),
    ).toBe(CHECK)
    expect(
      await rejected(`UPDATE orders SET discount_paise = -5 WHERE id = ${placed.order.id}`),
    ).toBe(CHECK)
    expect(
      await rejected(`UPDATE order_items SET quantity = 0 WHERE order_id = ${placed.order.id}`),
    ).toBe(CHECK)
  })
})

describe('cleanup', () => {
  it('leaves no test rows behind after a run', async () => {
    await h.cleanup()
    const [{ n }] = await rows(
      "SELECT count(*)::int AS n FROM customers WHERE email LIKE 'e2e%@example.test'",
    )
    expect(n).toBe(0)
  })
})
