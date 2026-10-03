import type { Cart, CartItem } from '../payload-types'
import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { requireCustomer } from '../access/customers'
import { MobileAPIError } from '../lib/api-response'
import { relationshipID } from '../lib/catalog'
import { normalizeCouponCode } from '../lib/customer-validation'
import { parseRouteID } from './addresses'
import { assertCouponAvailable } from './coupons/redemptions'
import { transactionDatabase, withTransaction } from './database/transaction'
import { calculateCartPricing, validateCouponForCart } from './pricing'

const findActiveCart = (req: PayloadRequest, customerID: number | string) =>
  req.payload.find({
    collection: 'carts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ customer: { equals: customerID } }, { status: { equals: 'active' } }] },
  })

const getActiveCart = async (req: PayloadRequest): Promise<Cart> => {
  const customer = requireCustomer(req)
  const result = await findActiveCart(req, customer.id)
  if (result.docs[0]) return result.docs[0]
  try {
    return await req.payload.create({
      collection: 'carts',
      data: { currency: 'INR', customer: customer.id as number, status: 'active' },
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // A parallel request created the cart first (one active cart per customer is a database rule).
    const winner = await findActiveCart(req, customer.id)
    if (winner.docs[0]) return winner.docs[0]
    throw error
  }
}

/**
 * Runs a cart change while holding the cart row lock, so rapid taps from one phone (or two
 * devices) are applied one after another instead of overwriting each other.
 */
const withLockedCart = async <T>(
  req: PayloadRequest,
  run: (cart: Cart) => Promise<T>,
): Promise<T> => {
  const cart = await getActiveCart(req)
  return withTransaction(req, async () => {
    const db = await transactionDatabase(req)
    await db.execute(sql`SELECT id FROM carts WHERE id = ${cart.id} FOR UPDATE`)
    return run(cart)
  })
}

const cartItems = async (req: PayloadRequest, cartID: number): Promise<CartItem[]> => {
  const result = await req.payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    req,
    sort: 'createdAt',
    where: { cart: { equals: cartID } },
  })
  return result.docs
}

const cartView = async (req: PayloadRequest, cart: Cart) => {
  const items = await cartItems(req, cart.id)
  return { cartId: cart.id, ...(await calculateCartPricing(req, cart, items)) }
}

const positiveInteger = (value: unknown, name: string): number => {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new MobileAPIError('VALIDATION_ERROR', `${name} must be a positive integer.`)
  }
  return result
}

const assertSellable = async (
  req: PayloadRequest,
  variantID: number,
  requestedQuantity: number,
) => {
  const variant = await req.payload.findByID({
    collection: 'product-variants',
    id: variantID,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const productID = relationshipID(variant.product)
  if (variant.status !== 'active' || !productID) {
    throw new MobileAPIError('UNAVAILABLE_VARIANT', 'Variant is not available.', 422)
  }
  const product = await req.payload.findByID({
    collection: 'products',
    id: productID,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (product.status !== 'active') {
    throw new MobileAPIError('UNAVAILABLE_PRODUCT', 'Product is not active.', 422)
  }
  if (requestedQuantity > Number(variant.maxPerOrder ?? 10)) {
    throw new MobileAPIError(
      'MAX_QUANTITY_EXCEEDED',
      `Maximum allowed quantity is ${variant.maxPerOrder ?? 10}.`,
      422,
    )
  }
  const inventory = await req.payload.find({
    collection: 'inventory',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { variant: { equals: variantID } },
  })
  const stock = inventory.docs[0]
  const available =
    stock?.stockStatus === 'available' ? Number(stock.onHand) - Number(stock.reserved) : 0
  if (requestedQuantity > available) {
    throw new MobileAPIError(
      'INSUFFICIENT_STOCK',
      `Only ${Math.max(0, available)} item(s) are currently available.`,
      422,
    )
  }
  return { product, variant }
}

export const getCart = async (req: PayloadRequest) => cartView(req, await getActiveCart(req))

export const addCartItem = async (req: PayloadRequest, value: unknown) => {
  requireCustomer(req)
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  const body = value as Record<string, unknown>
  const variantID = positiveInteger(body.variantId, 'variantId')
  const quantity = positiveInteger(body.quantity ?? 1, 'quantity')
  return withLockedCart(req, async (cart) => {
    const existing = await req.payload.find({
      collection: 'cart-items',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { and: [{ cart: { equals: cart.id } }, { variant: { equals: variantID } }] },
    })
    const nextQuantity = quantity + Number(existing.docs[0]?.quantity ?? 0)
    const { variant } = await assertSellable(req, variantID, nextQuantity)
    if (
      body.productId !== undefined &&
      Number(body.productId) !== relationshipID(variant.product)
    ) {
      throw new MobileAPIError(
        'VARIANT_PRODUCT_MISMATCH',
        'Variant does not belong to product.',
        422,
      )
    }
    if (existing.docs[0]) {
      await req.payload.update({
        collection: 'cart-items',
        id: existing.docs[0].id,
        data: { quantity: nextQuantity },
        depth: 0,
        overrideAccess: true,
        req,
      })
    } else {
      await req.payload.create({
        collection: 'cart-items',
        data: { cart: cart.id, quantity, variant: variantID },
        depth: 0,
        overrideAccess: true,
        req,
      })
    }
    return cartView(req, cart)
  })
}

const ownedItem = async (req: PayloadRequest, id: number) => {
  const cart = await getActiveCart(req)
  const result = await req.payload.find({
    collection: 'cart-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ id: { equals: id } }, { cart: { equals: cart.id } }] },
  })
  if (!result.docs[0]) throw new MobileAPIError('NOT_FOUND', 'Cart item not found.', 404)
  return { cart, item: result.docs[0] }
}

export const updateCartItem = async (req: PayloadRequest, value: unknown) => {
  requireCustomer(req)
  const id = parseRouteID(req, 'itemId')
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  const body = value as Record<string, unknown>
  return withLockedCart(req, async () => {
    const { cart, item } = await ownedItem(req, id)
    let quantity: number
    if (body.action === 'increase') quantity = Number(item.quantity) + 1
    else if (body.action === 'decrease') quantity = Number(item.quantity) - 1
    else quantity = positiveInteger(body.quantity, 'quantity')
    if (quantity <= 0) {
      await req.payload.delete({ collection: 'cart-items', id, overrideAccess: true, req })
      return cartView(req, cart)
    }
    const variantID = relationshipID(item.variant)
    if (!variantID) throw new MobileAPIError('UNAVAILABLE_VARIANT', 'Variant is unavailable.', 422)
    await assertSellable(req, Number(variantID), quantity)
    await req.payload.update({
      collection: 'cart-items',
      id,
      data: { quantity },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return cartView(req, cart)
  })
}

export const removeCartItem = async (req: PayloadRequest) => {
  const id = parseRouteID(req, 'itemId')
  return withLockedCart(req, async () => {
    const { cart } = await ownedItem(req, id)
    await req.payload.delete({ collection: 'cart-items', id, overrideAccess: true, req })
    return cartView(req, cart)
  })
}

export const clearCart = async (req: PayloadRequest) =>
  withLockedCart(req, async (cart) => {
    await req.payload.delete({
      collection: 'cart-items',
      overrideAccess: true,
      req,
      where: { cart: { equals: cart.id } },
    })
    const cleared = cart.coupon
      ? await req.payload.update({
          collection: 'carts',
          id: cart.id,
          data: { coupon: null },
          depth: 0,
          overrideAccess: true,
          req,
        })
      : cart
    return cartView(req, cleared)
  })

export const applyCartCoupon = async (req: PayloadRequest, value: unknown) => {
  const customer = requireCustomer(req)
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  const code = normalizeCouponCode(String((value as Record<string, unknown>).code ?? ''))
  if (!code) throw new MobileAPIError('VALIDATION_ERROR', 'Coupon code is required.')
  return withLockedCart(req, async (cart) => {
    const current = await cartView(req, { ...cart, coupon: null })
    const coupon = await validateCouponForCart(req, code, current.subtotalPaise)
    await assertCouponAvailable(req, coupon, customer.id)
    const updated = await req.payload.update({
      collection: 'carts',
      id: cart.id,
      data: { coupon: coupon.id },
      depth: 0,
      overrideAccess: true,
      req,
    })
    const priced = await cartView(req, updated)
    if (!priced.coupon) {
      await req.payload.update({
        collection: 'carts',
        id: cart.id,
        data: { coupon: null },
        depth: 0,
        overrideAccess: true,
        req,
      })
      throw new MobileAPIError(
        'INELIGIBLE_COUPON',
        'Coupon does not apply to the items in your bag.',
        422,
      )
    }
    return priced
  })
}

export const removeCartCoupon = async (req: PayloadRequest) =>
  withLockedCart(req, async (cart) => {
    const updated = await req.payload.update({
      collection: 'carts',
      id: cart.id,
      data: { coupon: null },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return cartView(req, updated)
  })
