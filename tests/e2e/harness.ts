/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * End-to-end harness.
 *
 *  - Runs the real Payload REST handlers (custom endpoints, auth, hooks, access control) and the
 *    real PostgreSQL schema, without starting a web server.
 *  - Routes the mobile app's `fetch` calls into those handlers, so the app's own API client,
 *    services and mappers (../mobile/src) are what the tests drive.
 *  - Replaces api.razorpay.com with a controlled fixture. Nothing here talks to the real gateway,
 *    so these tests prove our handling of gateway responses, not a live Razorpay integration.
 *
 * Safety: refuses to run unless the database is named `*_test`, or E2E_ALLOW_SHARED_DB=true is
 * set explicitly. Even then it only creates rows tagged with a per-run prefix and removes only
 * those rows afterwards.
 */
import 'dotenv/config'

import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'

export const API_ORIGIN = 'http://api.test'
const KEY_ID = 'rzp_test_e2e_key'
const KEY_SECRET = 'e2e_key_secret_value'
const WEBHOOK_SECRET = 'e2e_webhook_secret_value'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
if (!/_test$/.test(databaseName) && process.env.E2E_ALLOW_SHARED_DB !== 'true') {
  throw new Error(
    `Refusing to run E2E tests against "${databaseName}". Use a database named *_test (TEST_DATABASE_URL) ` +
      'or set E2E_ALLOW_SHARED_DB=true to run against a shared database with per-run tagged data.',
  )
}
process.env.DATABASE_URL = databaseUrl
process.env.PAYMENT_PROVIDER = 'razorpay'
process.env.RAZORPAY_KEY_ID = KEY_ID
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED ?? 'false'
process.env.MAINTENANCE_JOBS_ENABLED = 'false'
process.env.INVENTORY_RESERVATION_MINUTES = process.env.INVENTORY_RESERVATION_MINUTES ?? '15'

export const runTag = `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
export const password = 'E2ePassw0rdSecure'
export const emailFor = (name: string) => `${runTag}-${name}@example.test`

/* ------------------------------------------------------------------ gateway fixture */

type GatewayPayment = {
  amount: number
  captured: boolean
  currency: string
  id: string
  order_id: string
  status: string
}

export class GatewayFixture {
  orders = new Map<string, { amount: number; currency: string; receipt: string }>()
  payments = new Map<string, GatewayPayment>()
  requests: string[] = []
  private counter = 0
  /** When set, the next `POST /orders` fails like a gateway outage. */
  failNextOrderCreation = false

  async handle(url: URL, init?: RequestInit): Promise<Response> {
    this.requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status,
      })
    if (url.pathname === '/v1/orders' && init?.method === 'POST') {
      if (this.failNextOrderCreation) {
        this.failNextOrderCreation = false
        return json({ error: 'gateway_down' }, 503)
      }
      const body = JSON.parse(String(init.body))
      const id = `order_E2E${++this.counter}`
      this.orders.set(id, { amount: body.amount, currency: body.currency, receipt: body.receipt })
      return json({ amount: body.amount, currency: body.currency, id, status: 'created' })
    }
    const orderPayments = /^\/v1\/orders\/([^/]+)\/payments$/.exec(url.pathname)
    if (orderPayments) {
      return json({
        items: [...this.payments.values()].filter(
          (payment) => payment.order_id === orderPayments[1],
        ),
      })
    }
    const payment = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname)
    if (payment) {
      const found = this.payments.get(payment[1])
      return found ? json(found) : json({ error: 'not_found' }, 404)
    }
    return json({ error: 'unhandled' }, 404)
  }

  /** What the Razorpay SDK would hand back to the app after the customer pays. */
  pay(
    providerOrderId: string,
    options: { amount?: number; status?: 'captured' | 'failed' } = {},
  ): { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string } {
    const order = this.orders.get(providerOrderId)
    if (!order) throw new Error(`Gateway fixture has no order ${providerOrderId}`)
    const status = options.status ?? 'captured'
    const id = `pay_E2E${++this.counter}`
    this.payments.set(id, {
      amount: options.amount ?? order.amount,
      captured: status === 'captured',
      currency: order.currency,
      id,
      order_id: providerOrderId,
      status,
    })
    return {
      razorpay_order_id: providerOrderId,
      razorpay_payment_id: id,
      razorpay_signature: createHmac('sha256', KEY_SECRET)
        .update(`${providerOrderId}|${id}`)
        .digest('hex'),
    }
  }

  webhookBody(
    event: 'payment.captured' | 'payment.failed' | 'order.paid',
    paymentId: string,
  ): string {
    const payment = this.payments.get(paymentId)
    if (!payment) throw new Error(`Gateway fixture has no payment ${paymentId}`)
    return JSON.stringify({ event, payload: { payment: { entity: payment } } })
  }

  static sign(rawBody: string, secret = WEBHOOK_SECRET): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex')
  }
}

/* ------------------------------------------------------------------ harness */

export type Harness = {
  admin: { email: string; id: number }
  catalog: CatalogFactory
  cleanup: () => Promise<void>
  gateway: GatewayFixture
  payload: Payload
  /** Set known shipping rules for the run; the original values are restored by cleanup(). */
  setShipping: (
    values: Partial<{
      codEnabled: boolean
      codFeePaise: number
      freeShippingAbovePaise: number
      standardFeePaise: number
    }>,
  ) => Promise<void>
  /** Make every active inventory hold for an order expire immediately. */
  expireHolds: (orderId: number | string) => Promise<void>
  postWebhook: (
    rawBody: string,
    options?: { eventId?: string; signature?: string },
  ) => Promise<Response>
  rest: (
    method: string,
    path: string,
    init?: { body?: unknown; headers?: Record<string, string>; token?: string },
  ) => Promise<Response>
}

type CatalogFactory = {
  coupon: (input: {
    code: string
    discountType?: 'fixed' | 'percentage'
    discountValue: number
    maxDiscountPaise?: number
    minimumCartPaise?: number
    perCustomerLimit?: number
    usageLimit?: number
  }) => Promise<{ id: number; code: string }>
  product: (input: {
    name: string
    pricePaise: number
    stock: number
    maxPerOrder?: number
  }) => Promise<{ inventoryId: number; productId: number; sku: string; variantId: number }>
}

const created = {
  categories: [] as number[],
  coupons: [] as number[],
  media: [] as number[],
  products: [] as number[],
  promotions: [] as number[],
  variants: [] as number[],
}

export const startHarness = async (): Promise<Harness> => {
  const [{ getPayload }, { default: config }, routes] = await Promise.all([
    import('payload'),
    import('@payload-config'),
    import('@payloadcms/next/routes'),
  ])
  const payload = await getPayload({ config })
  const handlers: Record<
    string,
    (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>
  > = {
    DELETE: routes.REST_DELETE(config) as any,
    GET: routes.REST_GET(config) as any,
    OPTIONS: routes.REST_OPTIONS(config) as any,
    PATCH: routes.REST_PATCH(config) as any,
    POST: routes.REST_POST(config) as any,
    PUT: routes.REST_PUT(config) as any,
  }
  const gateway = new GatewayFixture()

  // Everything the mobile app (and the backend's gateway client) sends goes through here.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
    )
    if (url.origin === 'https://api.razorpay.com') return gateway.handle(url, init)
    if (url.origin !== API_ORIGIN) throw new Error(`Unexpected outbound request to ${url.origin}`)
    const method = (init?.method ?? 'GET').toUpperCase()
    const slug = url.pathname
      .replace(/^\/api\//, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent)
    const request = new Request(url, {
      body: init?.body as BodyInit | undefined,
      headers: init?.headers as HeadersInit,
      method,
      signal: init?.signal ?? undefined,
    })
    return handlers[method](request, { params: Promise.resolve({ slug }) })
  }) as typeof fetch

  const rest: Harness['rest'] = (method, path, init = {}) =>
    fetch(`${API_ORIGIN}/api${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.token ? { Authorization: `JWT ${init.token}` } : {}),
        ...(init.headers ?? {}),
      },
      method,
    })

  // Webhooks need the exact raw string for signature checks, so they bypass JSON encoding in rest.
  const postRawWebhook: Harness['postWebhook'] = (rawBody, options = {}) =>
    fetch(`${API_ORIGIN}/api/payments/webhooks/razorpay`, {
      body: rawBody,
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-event-id':
          options.eventId ?? `evt_${runTag}_${Math.random().toString(36).slice(2)}`,
        'x-razorpay-signature': options.signature ?? GatewayFixture.sign(rawBody),
      },
      method: 'POST',
    })

  let originalShipping: Record<string, unknown> | undefined
  const setShipping: Harness['setShipping'] = async (values) => {
    if (!originalShipping) {
      originalShipping = (await payload.findGlobal({
        slug: 'shipping-settings',
        depth: 0,
        overrideAccess: true,
      })) as unknown as Record<string, unknown>
    }
    await payload.updateGlobal({
      slug: 'shipping-settings',
      data: values as any,
      overrideAccess: true,
    })
  }
  const expireHolds: Harness['expireHolds'] = async (orderId) => {
    await payload.update({
      collection: 'inventory-reservations',
      data: { expiresAt: new Date(Date.now() - 60_000).toISOString() },
      overrideAccess: true,
      where: { and: [{ order: { equals: orderId } }, { status: { equals: 'active' } }] },
    })
  }

  /**
   * Remove rows created by E2E runs, children before parents. Everything the harness creates is
   * tagged with an "e2e" prefix (emails, slugs, SKUs, coupon codes, event ids), so a plain SQL
   * prefix match removes only test data - including leftovers from earlier interrupted runs.
   * Plain SQL is used on purpose: Payload business rules (for example "a product keeps one active
   * variant") would otherwise block tearing the data down.
   */
  const cleanup = async () => {
    if (originalShipping) {
      const {
        codEnabled,
        codFeePaise,
        freeShippingAbovePaise,
        handlingDays,
        localServiceabilityMode,
        standardFeePaise,
      } = originalShipping as any
      await payload.updateGlobal({
        slug: 'shipping-settings',
        data: {
          codEnabled,
          codFeePaise,
          freeShippingAbovePaise,
          handlingDays,
          localServiceabilityMode,
          standardFeePaise,
        },
        overrideAccess: true,
      })
    }
    const { sql } = await import('@payloadcms/db-postgres')
    const db = (payload.db as any).drizzle
    const customers = "(SELECT id FROM customers WHERE email LIKE 'e2e%@example.test')"
    const orders = `(SELECT id FROM orders WHERE customer_id IN ${customers})`
    const products = "(SELECT id FROM products WHERE slug LIKE 'e2e%')"
    const variants = `(SELECT id FROM product_variants WHERE product_id IN ${products})`
    const carts = `(SELECT id FROM carts WHERE customer_id IN ${customers})`
    const wishlists = `(SELECT id FROM wishlists WHERE customer_id IN ${customers})`
    const statements = [
      `DELETE FROM coupon_redemptions WHERE order_id IN ${orders}`,
      `DELETE FROM payment_attempts WHERE order_id IN ${orders}`,
      `DELETE FROM inventory_reservations WHERE order_id IN ${orders} OR variant_id IN ${variants}`,
      `DELETE FROM order_status_events WHERE order_id IN ${orders}`,
      `DELETE FROM order_items WHERE order_id IN ${orders} OR product_id IN ${products}`,
      `UPDATE carts SET converted_order_id = NULL WHERE converted_order_id IN ${orders}`,
      `DELETE FROM orders WHERE id IN ${orders}`,
      `DELETE FROM payment_webhook_events WHERE external_event_id LIKE 'evt_e2e%' OR external_event_id LIKE 'evt_dup_%'`,
      `DELETE FROM cart_items WHERE cart_id IN ${carts} OR variant_id IN ${variants}`,
      `DELETE FROM carts WHERE customer_id IN ${customers}`,
      `DELETE FROM wishlist_items WHERE wishlist_id IN ${wishlists} OR product_id IN ${products}`,
      `DELETE FROM wishlists WHERE customer_id IN ${customers}`,
      `DELETE FROM customer_addresses WHERE customer_id IN ${customers}`,
      `DELETE FROM customers WHERE email LIKE 'e2e%@example.test'`,
      `DELETE FROM inventory_movements WHERE variant_id IN ${variants}`,
      `DELETE FROM inventory WHERE variant_id IN ${variants}`,
      `DELETE FROM product_variants WHERE product_id IN ${products}`,
      `DELETE FROM products WHERE slug LIKE 'e2e%'`,
      `DELETE FROM coupons WHERE code LIKE 'E2E%'`,
      `DELETE FROM promotions WHERE name LIKE 'E2E e2e%'`,
      `DELETE FROM categories WHERE slug LIKE 'e2e%'`,
      `DELETE FROM media WHERE alt = 'E2E placeholder'`,
      `DELETE FROM admins WHERE email LIKE 'e2e%@example.test'`,
    ]
    // Remove uploaded e2e files (named e2e-*) left in the media folder.
    const mediaDir = path.resolve(process.cwd(), 'media')
    if (fs.existsSync(mediaDir)) {
      for (const name of fs.readdirSync(mediaDir)) {
        if (name.startsWith('e2e-')) fs.rmSync(path.join(mediaDir, name), { force: true })
      }
    }
    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement))
      } catch (error) {
        console.warn(
          `E2E cleanup step failed: ${statement.slice(0, 60)}... ${(error as Error).message}`,
        )
      }
    }
  }

  // Clear anything left behind by earlier interrupted runs before creating new data.
  await cleanup()

  // A real super administrator, created through the same bootstrap rule the Admin panel uses.
  const adminEmail = emailFor('admin')
  const admin = await payload.create({
    collection: 'admins',
    data: {
      email: adminEmail,
      name: 'E2E Admin',
      password,
      role: 'super_admin',
      status: 'active',
    } as any,
    overrideAccess: true,
  })

  const sharedCategory = await payload.create({
    collection: 'categories',
    data: { isActive: true, name: `E2E ${runTag}`, slug: `${runTag}-cat`, sortOrder: 999 },
    overrideAccess: true,
  })
  created.categories.push(sharedCategory.id)
  // Upload under a unique e2e- name so the stored file can be recognised and removed afterwards.
  const uploadSource = path.join(os.tmpdir(), `e2e-${runTag}.svg`)
  fs.copyFileSync(
    fileURLToPath(new URL('../../src/seed/assets/jewelry-placeholder.svg', import.meta.url)),
    uploadSource,
  )
  const media = await payload.create({
    collection: 'media',
    data: { alt: 'E2E placeholder', kind: 'product' },
    filePath: uploadSource,
    overrideAccess: true,
  })
  fs.rmSync(uploadSource, { force: true })
  created.media.push(media.id)

  let skuCounter = 0
  const catalog: CatalogFactory = {
    async product({ maxPerOrder = 5, name, pricePaise, stock }) {
      const slug = `${runTag}-p${++skuCounter}`
      const sku = `${runTag}-SKU${skuCounter}`.toUpperCase()
      const product = await payload.create({
        collection: 'products',
        data: {
          featuredImage: media.id,
          name,
          primaryCategory: sharedCategory.id,
          slug,
          status: 'draft',
        } as any,
        overrideAccess: true,
      })
      created.products.push(product.id)
      const variant = await payload.create({
        collection: 'product-variants',
        data: {
          colorCode: 'gold',
          maxPerOrder,
          optionSignature: `free-size|gold|${skuCounter}`,
          pricePaise,
          product: product.id,
          sizeCode: 'free-size',
          sku,
          status: 'active',
        } as any,
        overrideAccess: true,
      })
      created.variants.push(variant.id)
      const inventory = await payload.create({
        collection: 'inventory',
        context: { inventoryAdjustment: { note: 'e2e stock', reason: 'initial_stock' } },
        data: {
          onHand: stock,
          reorderPoint: 0,
          reserved: 0,
          stockStatus: 'available',
          variant: variant.id,
        },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'products',
        id: product.id,
        data: { status: 'active' },
        overrideAccess: true,
      })
      return { inventoryId: inventory.id, productId: product.id, sku, variantId: variant.id }
    },
    async coupon({
      code,
      discountType = 'percentage',
      discountValue,
      maxDiscountPaise,
      minimumCartPaise = 0,
      perCustomerLimit = 1,
      usageLimit,
    }) {
      const promotion = await payload.create({
        collection: 'promotions',
        data: {
          discountType,
          discountValue,
          maxDiscountPaise,
          name: `E2E ${runTag} ${code}`,
          status: 'active',
        } as any,
        overrideAccess: true,
      })
      created.promotions.push(promotion.id)
      const coupon = await payload.create({
        collection: 'coupons',
        data: {
          code: `${runTag}-${code}`.toUpperCase(),
          minimumCartPaise,
          perCustomerLimit,
          promotion: promotion.id,
          status: 'active',
          usageLimit,
        } as any,
        overrideAccess: true,
      })
      created.coupons.push(coupon.id)
      return { code: coupon.code, id: coupon.id }
    },
  }

  return {
    admin: { email: adminEmail, id: admin.id },
    catalog,
    cleanup,
    gateway,
    payload,
    postWebhook: postRawWebhook,
    rest,
    setShipping,
    expireHolds,
  }
}
