import { createHmac } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import { MobileAPIError } from '@/lib/api-response'
import { checkoutPreview } from '@/services/checkout/pricing'
import { placeOrder, transitionOrder } from '@/services/orders/order-service'
import { RazorpayProvider } from '@/services/payments/razorpay.provider'
import { calculateDiscountPaise } from '@/services/pricing'

const originalEnvironment = {
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const previewRequest = ({
  address = true,
  stock = 4,
}: { address?: boolean; stock?: number } = {}) => {
  const documents = {
    cart: { id: 11, coupon: null, currency: 'INR', customer: 7, status: 'active' },
    item: { id: 12, cart: 11, quantity: 2, variant: 20 },
    variant: {
      id: 20,
      colorCode: 'gold',
      pricePaise: 12500,
      product: 30,
      sizeCode: '2.6',
      sku: 'BGL-20',
      status: 'active',
    },
    product: {
      id: 30,
      categories: [],
      name: 'Jaipur Bangle',
      primaryCategory: 1,
      slug: 'jaipur-bangle',
      status: 'active',
    },
    address: {
      id: 40,
      addressType: 'home',
      city: 'Jaipur',
      countryCode: 'IN',
      customer: 7,
      isActive: true,
      isDefault: true,
      line1: 'Johari Bazaar',
      phoneNumber: '+919999999999',
      pincode: '302003',
      recipientName: 'Customer',
      stateCode: 'RJ',
    },
  }
  const find = async ({ collection }: { collection: string }) => {
    if (collection === 'orders') return { docs: [], totalDocs: 0 }
    if (collection === 'carts') return { docs: [documents.cart], totalDocs: 1 }
    if (collection === 'cart-items') return { docs: [documents.item], totalDocs: 1 }
    if (collection === 'product-variants') return { docs: [documents.variant], totalDocs: 1 }
    if (collection === 'products') return { docs: [documents.product], totalDocs: 1 }
    if (collection === 'customer-addresses')
      return { docs: address ? [documents.address] : [], totalDocs: address ? 1 : 0 }
    if (collection === 'inventory')
      return {
        docs: [{ id: 50, onHand: stock, reserved: 0, stockStatus: 'available', variant: 20 }],
        totalDocs: 1,
      }
    return { docs: [], totalDocs: 0 }
  }
  const findByID = async ({ collection }: { collection: string }) => {
    if (collection === 'product-variants') return documents.variant
    if (collection === 'products') return documents.product
    throw new Error(`Unexpected collection: ${collection}`)
  }
  return {
    payload: {
      find,
      findByID,
      count: async () => ({ totalDocs: 0 }),
      findGlobal: async () => ({
        codEnabled: true,
        codFeePaise: 1000,
        freeShippingAbovePaise: 50000,
        handlingDays: 1,
        localServiceabilityMode: 'development_all_india',
        standardFeePaise: 5000,
      }),
    },
    url: 'http://localhost/api/checkout/preview',
    user: { collection: 'customers', id: 7, status: 'active' },
  } as unknown as PayloadRequest
}

describe('Phase 4 checkout pricing', () => {
  it('calculates a server-authoritative COD preview in paise', async () => {
    const result = await checkoutPreview(previewRequest(), { addressId: 40, paymentMethod: 'cod' })
    expect(result.itemsSubtotalPaise).toBe(25000)
    expect(result.shippingPaise).toBe(5000)
    expect(result.codFeePaise).toBe(1000)
    expect(result.grandTotalPaise).toBe(31000)
    expect(result.taxPolicy.productionReady).toBe(false)
  })

  it('rejects an address that does not belong to the customer', async () => {
    await expect(
      checkoutPreview(previewRequest({ address: false }), { addressId: 40, paymentMethod: 'cod' }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS', status: 422 })
  })

  it('rejects insufficient stock', async () => {
    await expect(
      checkoutPreview(previewRequest({ stock: 1 }), { addressId: 40, paymentMethod: 'cod' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 })
  })

  it('rejects unsupported payment methods', async () => {
    await expect(
      checkoutPreview(previewRequest(), { addressId: 40, paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYMENT_METHOD' })
  })

  it('uses deterministic floor rounding for percentage discounts', () => {
    expect(
      calculateDiscountPaise({
        discountType: 'percentage',
        discountValue: 15,
        eligibleSubtotalPaise: 999,
        subtotalPaise: 999,
      }),
    ).toBe(149)
  })
})

describe('Phase 4 payment security', () => {
  it('verifies Razorpay checkout signatures with HMAC-SHA256', () => {
    process.env.PAYMENT_PROVIDER = 'razorpay'
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture'
    process.env.RAZORPAY_KEY_SECRET = 'fixture-secret'
    const signature = createHmac('sha256', 'fixture-secret')
      .update('order_fixture|pay_fixture')
      .digest('hex')
    expect(
      new RazorpayProvider().verifyCheckoutSignature('order_fixture', 'pay_fixture', signature),
    ).toBe(true)
  })

  it('rejects an invalid Razorpay checkout signature', () => {
    process.env.RAZORPAY_KEY_SECRET = 'fixture-secret'
    expect(
      new RazorpayProvider().verifyCheckoutSignature('order_fixture', 'pay_fixture', 'invalid'),
    ).toBe(false)
  })

  it('verifies webhook signatures against the exact raw body', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-fixture'
    const raw = '{"event":"payment.captured"}'
    const signature = createHmac('sha256', 'webhook-fixture').update(raw).digest('hex')
    expect(new RazorpayProvider().verifyWebhookSignature(raw, signature)).toBe(true)
    expect(new RazorpayProvider().verifyWebhookSignature(`${raw}\n`, signature)).toBe(false)
  })

  it('fails online placement before mutation when credentials are absent', async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay'
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    await expect(
      placeOrder(previewRequest(), {
        addressId: 40,
        idempotencyKey: 'fixture-key-123',
        paymentMethod: 'upi',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', status: 503 })
  })
})

describe('Phase 4 order lifecycle', () => {
  it('rejects invalid terminal-state transitions before writing', async () => {
    const request = {
      user: { collection: 'admins', id: 1, role: 'order_manager', status: 'active' },
    } as unknown as PayloadRequest
    const order = { id: 1, paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'delivered' }
    await expect(
      transitionOrder(request, order as never, 'processing', 'admin'),
    ).rejects.toBeInstanceOf(MobileAPIError)
  })
})
