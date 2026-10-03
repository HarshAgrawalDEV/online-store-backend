import type { Cart, CartItem, Coupon, CustomerAddress } from '../../payload-types'
import type { PayloadRequest } from 'payload'

import { requireCustomer } from '../../access/customers'
import { MobileAPIError } from '../../lib/api-response'
import { relationshipID } from '../../lib/catalog'
import { normalizeCouponCode } from '../../lib/customer-validation'
import { assertCouponAvailable } from '../coupons/redemptions'
import { calculateCartPricing, validateCouponForCart } from '../pricing'

export type CheckoutPaymentMethod = 'card' | 'cod' | 'netbanking' | 'upi' | 'wallet'

const paymentMethods = new Set<CheckoutPaymentMethod>([
  'card',
  'cod',
  'netbanking',
  'upi',
  'wallet',
])

const bodyObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object')
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  return value as Record<string, unknown>
}

const requiredID = (value: unknown, field: string): number => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MobileAPIError('VALIDATION_ERROR', `${field} is invalid.`)
  return id
}

const activeCart = async (req: PayloadRequest, customerID: number): Promise<Cart> => {
  const result = await req.payload.find({
    collection: 'carts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ customer: { equals: customerID } }, { status: { equals: 'active' } }] },
  })
  if (!result.docs[0]) throw new MobileAPIError('EMPTY_CART', 'Your cart is empty.', 422)
  return result.docs[0]
}

const loadItems = async (req: PayloadRequest, cartID: number): Promise<CartItem[]> => {
  const result = await req.payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: { cart: { equals: cartID } },
  })
  if (!result.docs.length) throw new MobileAPIError('EMPTY_CART', 'Your cart is empty.', 422)
  return result.docs
}

const ownedAddress = async (
  req: PayloadRequest,
  addressID: number,
  customerID: number,
): Promise<CustomerAddress> => {
  const result = await req.payload.find({
    collection: 'customer-addresses',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: {
      and: [
        { id: { equals: addressID } },
        { customer: { equals: customerID } },
        { isActive: { equals: true } },
      ],
    },
  })
  if (!result.docs[0])
    throw new MobileAPIError('INVALID_ADDRESS', 'Delivery address was not found.', 422)
  return result.docs[0]
}

const requestedCoupon = async (
  req: PayloadRequest,
  cart: Cart,
  value: unknown,
  subtotalPaise: number,
): Promise<null | Coupon> => {
  if (value === null || value === '') return null
  if (typeof value === 'string')
    return validateCouponForCart(req, normalizeCouponCode(value), subtotalPaise)
  const couponID = relationshipID(cart.coupon)
  if (!couponID) return null
  return req.payload.findByID({
    collection: 'coupons',
    id: couponID,
    depth: 0,
    overrideAccess: true,
    req,
  })
}

export const checkoutPreview = async (req: PayloadRequest, input: unknown) => {
  const customer = requireCustomer(req)
  const body = bodyObject(input)
  const addressID = requiredID(body.addressId, 'addressId')
  const paymentMethod = String(body.paymentMethod ?? '') as CheckoutPaymentMethod
  if (!paymentMethods.has(paymentMethod)) {
    throw new MobileAPIError('UNSUPPORTED_PAYMENT_METHOD', 'Payment method is not supported.', 422)
  }

  const customerID = Number(customer.id)
  const [cart, address] = await Promise.all([
    activeCart(req, customerID),
    ownedAddress(req, addressID, customerID),
  ])
  const items = await loadItems(req, cart.id)
  const basePricing = await calculateCartPricing(req, { ...cart, coupon: null }, items)
  const coupon = await requestedCoupon(req, cart, body.couponCode, basePricing.subtotalPaise)
  const pricing = await calculateCartPricing(req, { ...cart, coupon: coupon?.id ?? null }, items)
  if (coupon && !pricing.coupon)
    throw new MobileAPIError('INELIGIBLE_COUPON', 'Coupon does not apply to this cart.', 422)
  if (coupon) await assertCouponAvailable(req, coupon, customerID)
  if (pricing.lines.some((line) => !line.valid)) {
    throw new MobileAPIError(
      'UNAVAILABLE_ITEM',
      'One or more cart items are no longer purchasable.',
      422,
    )
  }

  for (const line of pricing.lines) {
    const inventory = await req.payload.find({
      collection: 'inventory',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { variant: { equals: line.variant.id } },
    })
    const record = inventory.docs[0]
    if (
      !record ||
      record.stockStatus !== 'available' ||
      Number(record.onHand) - Number(record.reserved) < line.quantity
    ) {
      throw new MobileAPIError(
        'INSUFFICIENT_STOCK',
        `${line.product.name} does not have enough stock.`,
        409,
      )
    }
  }

  const shippingSettings = await req.payload.findGlobal({
    slug: 'shipping-settings',
    overrideAccess: true,
    req,
  })
  if (shippingSettings.localServiceabilityMode === 'disabled') {
    throw new MobileAPIError(
      'DELIVERY_UNAVAILABLE',
      'Delivery serviceability is not configured for this store.',
      422,
    )
  }
  if (paymentMethod === 'cod' && !shippingSettings.codEnabled) {
    throw new MobileAPIError('COD_UNAVAILABLE', 'Cash on delivery is not available.', 422)
  }
  const threshold = Number(shippingSettings.freeShippingAbovePaise ?? 0)
  const afterDiscount = Math.max(0, pricing.subtotalPaise - pricing.discountPaise)
  const shippingPaise =
    threshold > 0 && afterDiscount >= threshold ? 0 : Number(shippingSettings.standardFeePaise ?? 0)
  const codFeePaise = paymentMethod === 'cod' ? Number(shippingSettings.codFeePaise ?? 0) : 0
  const taxPaise = 0
  const grandTotalPaise = afterDiscount + shippingPaise + codFeePaise + taxPaise
  if (grandTotalPaise <= 0)
    throw new MobileAPIError('INVALID_ORDER_TOTAL', 'Final payable amount must be positive.', 422)

  return {
    address,
    addressId: addressID,
    cart,
    cartId: cart.id,
    codFeePaise,
    coupon: pricing.coupon,
    currency: 'INR' as const,
    discountPaise: pricing.discountPaise,
    grandTotalPaise,
    itemsSubtotalPaise: pricing.subtotalPaise,
    lines: pricing.lines,
    paymentMethod,
    shippingPaise,
    shippingPolicy: {
      handlingDays: Number(shippingSettings.handlingDays ?? 1),
      serviceability: 'development_all_india',
    },
    taxPaise,
    taxPolicy: { mode: 'not_configured', productionReady: false },
  }
}

/** What the app may see of a checkout preview: amounts and lines, not stored records. */
export const publicCheckoutPreview = (preview: Awaited<ReturnType<typeof checkoutPreview>>) => ({
  addressId: preview.addressId,
  cartId: preview.cartId,
  codFeePaise: preview.codFeePaise,
  coupon: preview.coupon ? { code: preview.coupon.code } : null,
  currency: preview.currency,
  discountPaise: preview.discountPaise,
  grandTotalPaise: preview.grandTotalPaise,
  itemsSubtotalPaise: preview.itemsSubtotalPaise,
  lines: preview.lines,
  paymentMethod: preview.paymentMethod,
  shippingPaise: preview.shippingPaise,
  shippingPolicy: preview.shippingPolicy,
  taxPaise: preview.taxPaise,
  taxPolicy: preview.taxPolicy,
})
