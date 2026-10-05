import { createHash, randomBytes } from 'node:crypto'
import type { Coupon, Order, PaymentAttempt } from '../../payload-types'
import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, RequiredDataFromCollectionSlug } from 'payload'

import { canManageOrders } from '../../access/commerce'
import { requireCustomer } from '../../access/customers'
import { MobileAPIError } from '../../lib/api-response'
import { relationshipID } from '../../lib/catalog'
import { checkoutPreview } from '../checkout/pricing'
import { allocateCoupon, releaseOrderCoupon } from '../coupons/redemptions'
import { transactionDatabase, withTransaction } from '../database/transaction'
import {
  commitOrderReservations,
  releaseOrderReservations,
  reserveInventory,
  restockCommittedOrder,
} from '../inventory/reservations'
import { paymentProvider } from '../payments/razorpay.provider'

type OrderStatus = Order['status']

/**
 * Serialises concurrent changes to one order (cancel, payment confirmation, expiry, staff
 * transitions). Must run inside a transaction; returns the freshly read row.
 */
export const lockOrder = async (req: PayloadRequest, id: number): Promise<Order> => {
  const db = await transactionDatabase(req)
  await db.execute(sql`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`)
  return req.payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true, req })
}

const transitions: Record<OrderStatus, OrderStatus[]> = {
  cancelled: [],
  confirmed: ['processing', 'cancelled'],
  delivered: ['returned'],
  packed: ['shipped', 'cancelled'],
  pending_payment: ['confirmed', 'cancelled'],
  processing: ['packed', 'cancelled'],
  returned: [],
  shipped: ['delivered'],
}

const orderNumber = () =>
  `JJ-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`

const hashRequest = (customerID: number, body: Record<string, unknown>): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        addressId: Number(body.addressId),
        couponCode: String(body.couponCode ?? '')
          .trim()
          .toUpperCase(),
        customerID,
        paymentMethod: String(body.paymentMethod ?? ''),
      }),
    )
    .digest('hex')

const parseBody = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object')
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  return input as Record<string, unknown>
}

const idempotencyKey = (body: Record<string, unknown>): string => {
  const value = String(body.idempotencyKey ?? '').trim()
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(value)) {
    throw new MobileAPIError(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey must be 8-120 safe characters.',
    )
  }
  return value
}

const addressSnapshot = (address: Record<string, unknown>) => ({
  addressType: address.addressType,
  city: address.city,
  countryCode: address.countryCode,
  landmark: address.landmark ?? null,
  line1: address.line1,
  line2: address.line2 ?? null,
  phoneNumber: address.phoneNumber,
  pincode: address.pincode,
  recipientName: address.recipientName,
  stateCode: address.stateCode,
})

const lineDiscounts = (lines: Array<{ lineTotalPaise: number }>, discount: number): number[] => {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0)
  let assigned = 0
  return lines.map((line, index) => {
    const value =
      index === lines.length - 1
        ? discount - assigned
        : Math.floor((discount * line.lineTotalPaise) / subtotal)
    assigned += value
    return value
  })
}

export const getOrderDetails = async (req: PayloadRequest, order: Order) => {
  const [items, events, attempts] = await Promise.all([
    req.payload.find({
      collection: 'order-items',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      where: { order: { equals: order.id } },
    }),
    req.payload.find({
      collection: 'order-status-events',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      sort: 'occurredAt',
      where: { order: { equals: order.id } },
    }),
    req.payload.find({
      collection: 'payment-attempts',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      sort: '-initiatedAt',
      where: { order: { equals: order.id } },
    }),
  ])
  return {
    ...publicOrder(order),
    items: items.docs.map((item) => ({
      id: item.id,
      product: relationshipID(item.product) ?? null,
      variant: relationshipID(item.variant) ?? null,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      sizeSnapshot: item.sizeSnapshot ?? null,
      colorSnapshot: item.colorSnapshot ?? null,
      descriptionSnapshot: item.descriptionSnapshot ?? null,
      imageUrlSnapshot: item.imageUrlSnapshot ?? null,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      unitDiscountPaise: item.unitDiscountPaise,
      lineSubtotalPaise: item.lineSubtotalPaise,
      lineDiscountPaise: item.lineDiscountPaise,
      lineTotalPaise: item.lineTotalPaise,
    })),
    paymentAttempts: attempts.docs.map((attempt) => ({
      amountPaise: attempt.amountPaise,
      completedAt: attempt.completedAt,
      id: attempt.id,
      initiatedAt: attempt.initiatedAt,
      paymentMethod: attempt.paymentMethod,
      provider: attempt.provider,
      status: attempt.status,
    })),
    statusEvents: events.docs.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      occurredAt: event.occurredAt,
      // Staff notes stay internal; customer and system reasons are safe to show.
      reason: event.actorType === 'admin' ? null : (event.reason ?? null),
    })),
  }
}

/**
 * Customer-facing order. Built field by field so internal data (request hash, idempotency key,
 * customer and cart ids, pricing internals, exception codes, admin notes) never leaves the server.
 */
export const publicOrder = (order: Order) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  status: order.status,
  paymentStatus: order.paymentStatus,
  fulfillmentStatus: order.fulfillmentStatus,
  paymentMethod: order.paymentMethod,
  currency: order.currency,
  itemsSubtotalPaise: order.itemsSubtotalPaise,
  discountPaise: order.discountPaise,
  shippingPaise: order.shippingPaise,
  taxPaise: order.taxPaise,
  codFeePaise: order.codFeePaise,
  grandTotalPaise: order.grandTotalPaise,
  couponCodeSnapshot: order.couponCodeSnapshot ?? null,
  shippingAddressSnapshot: order.shippingAddressSnapshot,
  /** True while a captured payment is waiting for staff to review it. */
  paymentUnderReview: String(order.exceptionCode ?? '').startsWith('LATE_PAYMENT'),
  placedAt: order.placedAt,
  confirmedAt: order.confirmedAt ?? null,
  cancelledAt: order.cancelledAt ?? null,
})

const ownedOrder = async (req: PayloadRequest, id: number): Promise<Order> => {
  const customer = requireCustomer(req)
  const result = await req.payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ id: { equals: id } }, { customer: { equals: customer.id } }] },
  })
  if (!result.docs[0]) throw new MobileAPIError('ORDER_NOT_FOUND', 'Order was not found.', 404)
  return result.docs[0]
}

const existingOrder = async (req: PayloadRequest, customerID: number, key: string) => {
  const result = await req.payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ customer: { equals: customerID } }, { idempotencyKey: { equals: key } }] },
  })
  return result.docs[0]
}

const currentPaymentInitialization = async (req: PayloadRequest, order: Order) => {
  const result = await req.payload.find({
    collection: 'payment-attempts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    sort: '-initiatedAt',
    where: { order: { equals: order.id } },
  })
  const attempt = result.docs[0]
  if (!attempt || attempt.provider === 'manual_cod') return null
  return attempt.providerOrderId
    ? {
        amountPaise: attempt.amountPaise,
        attemptId: attempt.id,
        clientKey: paymentProvider().clientKey,
        currency: attempt.currency,
        provider: attempt.provider,
        providerOrderId: attempt.providerOrderId,
      }
    : null
}

export const placeOrder = async (req: PayloadRequest, input: unknown) => {
  const customer = requireCustomer(req)
  const body = parseBody(input)
  const key = idempotencyKey(body)
  const customerID = Number(customer.id)
  const requestHash = hashRequest(customerID, body)
  const found = await existingOrder(req, customerID, key)
  if (found) {
    if (found.requestHash !== requestHash)
      throw new MobileAPIError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was used with different checkout choices.',
        409,
      )
    return {
      idempotentReplay: true,
      order: await getOrderDetails(req, found),
      payment: await currentPaymentInitialization(req, found),
    }
  }

  const preview = await checkoutPreview(req, body)
  const provider = paymentProvider()
  if (preview.paymentMethod !== 'cod') provider.assertConfigured()
  const expiresAt = new Date(
    Date.now() + Number(process.env.INVENTORY_RESERVATION_MINUTES ?? 15) * 60_000,
  ).toISOString()
  const discounts = lineDiscounts(preview.lines, preview.discountPaise)

  let created: { attempt: null | PaymentAttempt; order: Order; replay: boolean }
  try {
    created = await withTransaction(req, async () => {
      const duplicate = await existingOrder(req, customerID, key)
      if (duplicate) {
        if (duplicate.requestHash !== requestHash)
          throw new MobileAPIError(
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key was used with different checkout choices.',
            409,
          )
        return { attempt: null, order: duplicate, replay: true }
      }
      const now = new Date().toISOString()
      const isCOD = preview.paymentMethod === 'cod'
      const order = await req.payload.create({
        collection: 'orders',
        data: {
          cart: preview.cartId,
          codFeePaise: preview.codFeePaise,
          confirmedAt: isCOD ? now : null,
          couponCodeSnapshot: preview.coupon?.code ?? null,
          currency: 'INR',
          customer: customerID,
          discountPaise: preview.discountPaise,
          fulfillmentStatus: 'unfulfilled',
          grandTotalPaise: preview.grandTotalPaise,
          idempotencyKey: key,
          itemsSubtotalPaise: preview.itemsSubtotalPaise,
          orderNumber: orderNumber(),
          paymentMethod: preview.paymentMethod,
          paymentStatus: isCOD ? 'unpaid' : 'pending',
          placedAt: now,
          pricingBreakdown: {
            lines: preview.lines,
            shippingPolicy: preview.shippingPolicy,
            taxPolicy: preview.taxPolicy,
          },
          requestHash,
          shippingAddressSnapshot: addressSnapshot(
            preview.address as unknown as Record<string, unknown>,
          ),
          shippingPaise: preview.shippingPaise,
          status: isCOD ? 'confirmed' : 'pending_payment',
          taxPaise: preview.taxPaise,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      await reserveInventory(
        req,
        order.id,
        preview.lines.map((line) => ({
          quantity: line.quantity,
          variantId: Number(line.variant.id),
        })),
        expiresAt,
      )
      for (let index = 0; index < preview.lines.length; index += 1) {
        const line = preview.lines[index]
        const discount = discounts[index]
        const itemData: RequiredDataFromCollectionSlug<'order-items'> = {
          colorSnapshot: line.variant.colorCode ?? undefined,
          descriptionSnapshot: line.variant.description?.slice(0, 300) || undefined,
          imageUrlSnapshot: line.product.imageUrl ?? undefined,
          lineDiscountPaise: discount,
          lineSubtotalPaise: line.lineTotalPaise,
          lineTaxPaise: 0,
          lineTotalPaise: line.lineTotalPaise - discount,
          product: line.product.id,
          productNameSnapshot: line.product.name,
          order: order.id,
          quantity: line.quantity,
          sizeSnapshot: line.variant.sizeCode ?? undefined,
          skuSnapshot: line.variant.sku,
          unitDiscountPaise: Math.floor(discount / line.quantity),
          unitPricePaise: line.unitPricePaise,
          variant: line.variant.id,
        }
        await req.payload.create({
          collection: 'order-items',
          data: itemData,
          depth: 0,
          overrideAccess: true,
          req,
        })
      }
      await req.payload.create({
        collection: 'order-status-events',
        data: {
          actorId: String(customerID),
          actorType: 'customer',
          eventType: 'order_created',
          occurredAt: now,
          order: order.id,
          toStatus: order.status,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (preview.coupon) {
        const coupon = (await req.payload.findByID({
          collection: 'coupons',
          id: preview.coupon.id,
          depth: 0,
          overrideAccess: true,
          req,
        })) as Coupon
        await allocateCoupon(req, coupon, customerID, order, preview.discountPaise, isCOD)
      }
      if (isCOD) await commitOrderReservations(req, order.id)
      const attempt = await req.payload.create({
        collection: 'payment-attempts',
        data: {
          amountPaise: preview.grandTotalPaise,
          currency: 'INR',
          idempotencyKey: `${customerID}:${key}:1`,
          initiatedAt: now,
          order: order.id,
          paymentMethod: preview.paymentMethod,
          provider: isCOD ? 'manual_cod' : 'razorpay',
          status: isCOD ? 'pending' : 'created',
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      await req.payload.update({
        collection: 'carts',
        id: preview.cartId,
        data: { convertedOrder: order.id, status: 'converted' },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return { attempt, order, replay: false }
    })
  } catch (error) {
    const concurrent = await existingOrder(req, customerID, key)
    if (concurrent?.requestHash === requestHash) {
      return {
        idempotentReplay: true,
        order: await getOrderDetails(req, concurrent),
        payment: await currentPaymentInitialization(req, concurrent),
      }
    }
    throw error
  }

  if (created.replay)
    return {
      idempotentReplay: true,
      order: await getOrderDetails(req, created.order),
      payment: await currentPaymentInitialization(req, created.order),
    }
  if (preview.paymentMethod === 'cod')
    return {
      idempotentReplay: false,
      order: await getOrderDetails(req, created.order),
      payment: null,
    }
  const attempt = created.attempt as PaymentAttempt
  try {
    const providerOrder = await provider.createOrder({
      amountPaise: created.order.grandTotalPaise,
      currency: 'INR',
      receipt: created.order.orderNumber,
    })
    if (
      providerOrder.amountPaise !== created.order.grandTotalPaise ||
      providerOrder.currency !== 'INR'
    )
      throw new MobileAPIError(
        'PAYMENT_AMOUNT_MISMATCH',
        'Payment provider returned an unexpected amount.',
        502,
      )
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: { providerOrderId: providerOrder.id, status: 'pending' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return {
      idempotentReplay: false,
      order: await getOrderDetails(req, created.order),
      payment: {
        amountPaise: created.order.grandTotalPaise,
        attemptId: attempt.id,
        clientKey: provider.clientKey,
        currency: 'INR',
        provider: provider.name,
        providerOrderId: providerOrder.id,
      },
    }
  } catch (error) {
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: {
        failureCode: 'GATEWAY_INITIALIZATION_UNCERTAIN',
        failureMessage: 'Gateway order creation did not complete; reconcile before retry.',
        status: 'pending',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    throw error
  }
}

export const listCustomerOrders = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  const url = new URL(req.url ?? 'http://localhost')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20)))
  const result = await req.payload.find({
    collection: 'orders',
    depth: 0,
    limit,
    page,
    overrideAccess: true,
    req,
    sort: '-placedAt',
    where: { customer: { equals: customer.id } },
  })
  return { ...result, docs: result.docs.map(publicOrder) }
}

export const getCustomerOrder = async (req: PayloadRequest, id: number) =>
  getOrderDetails(req, await ownedOrder(req, id))

export const transitionOrder = async (
  req: PayloadRequest,
  order: Order,
  next: OrderStatus,
  actorType: 'admin' | 'customer' | 'system',
  reason?: string,
) => {
  if (!transitions[order.status].includes(next))
    throw new MobileAPIError(
      'INVALID_ORDER_TRANSITION',
      `Cannot move order from ${order.status} to ${next}.`,
      409,
    )
  if (next === 'confirmed' && order.paymentMethod !== 'cod' && order.paymentStatus !== 'paid')
    throw new MobileAPIError(
      'PAYMENT_NOT_VERIFIED',
      'Online payment must be verified before confirmation.',
      409,
    )
  const now = new Date().toISOString()
  const updated = await req.payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      cancelledAt: next === 'cancelled' ? now : order.cancelledAt,
      confirmedAt: next === 'confirmed' ? now : order.confirmedAt,
      status: next,
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
  await req.payload.create({
    collection: 'order-status-events',
    data: {
      actorId: req.user?.id ? String(req.user.id) : undefined,
      actorType,
      eventType: next === 'cancelled' ? 'order_cancelled' : 'status_changed',
      fromStatus: order.status,
      occurredAt: now,
      order: order.id,
      reason,
      toStatus: next,
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return updated
}

export const cancelCustomerOrder = async (req: PayloadRequest, id: number, reason?: string) => {
  await ownedOrder(req, id)
  return withTransaction(req, async () => {
    const order = await lockOrder(req, id)
    if (order.paymentStatus === 'paid')
      throw new MobileAPIError(
        'REFUND_REQUIRED',
        'Paid orders require an authorized refund workflow.',
        409,
      )
    await releaseOrderReservations(req, order.id)
    await restockCommittedOrder(req, order.id)
    await releaseOrderCoupon(req, order.id)
    await transitionOrder(req, order, 'cancelled', 'customer', reason)
  }).then(() => getCustomerOrder(req, id))
}

export const adminTransitionOrder = async (
  req: PayloadRequest,
  id: number,
  next: string,
  reason?: string,
) => {
  if (!canManageOrders(req.user))
    throw new MobileAPIError('FORBIDDEN', 'Order manager access is required.', 403)
  if (!(next in transitions)) throw new MobileAPIError('VALIDATION_ERROR', 'Unknown order status.')
  await req.payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true, req })
  return withTransaction(req, async () => {
    const order = await lockOrder(req, id)
    if (next === 'cancelled') {
      if (order.paymentStatus === 'paid')
        throw new MobileAPIError(
          'REFUND_REQUIRED',
          'Paid orders require an authorized refund workflow.',
          409,
        )
      await releaseOrderReservations(req, order.id)
      await restockCommittedOrder(req, order.id)
      await releaseOrderCoupon(req, order.id)
    }
    return transitionOrder(req, order, next as OrderStatus, 'admin', reason)
  })
}
