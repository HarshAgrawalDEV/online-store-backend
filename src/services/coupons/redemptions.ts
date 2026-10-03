import { sql } from '@payloadcms/db-postgres'
import type { Coupon, Order } from '../../payload-types'
import type { PayloadRequest } from 'payload'

import { MobileAPIError } from '../../lib/api-response'
import { transactionDatabase } from '../database/transaction'

export const allocateCoupon = async (
  req: PayloadRequest,
  coupon: Coupon,
  customerID: number,
  order: Order,
  amountPaise: number,
  redeemImmediately: boolean,
) => {
  const db = await transactionDatabase(req)
  await db.execute(sql`SELECT id FROM coupons WHERE id = ${coupon.id} FOR UPDATE`)
  const activeStatuses = ['allocated', 'redeemed'] as const
  // Sequential on purpose: both queries share the transaction connection.
  const globalCount = await req.payload.count({
    collection: 'coupon-redemptions',
    overrideAccess: true,
    req,
    where: { and: [{ coupon: { equals: coupon.id } }, { status: { in: [...activeStatuses] } }] },
  })
  const customerCount = await req.payload.count({
    collection: 'coupon-redemptions',
    overrideAccess: true,
    req,
    where: {
      and: [
        { coupon: { equals: coupon.id } },
        { customer: { equals: customerID } },
        { status: { in: [...activeStatuses] } },
      ],
    },
  })
  if (coupon.usageLimit != null && globalCount.totalDocs >= Number(coupon.usageLimit)) {
    throw new MobileAPIError('COUPON_LIMIT_REACHED', 'Coupon usage limit has been reached.', 409)
  }
  if (
    coupon.perCustomerLimit != null &&
    customerCount.totalDocs >= Number(coupon.perCustomerLimit)
  ) {
    throw new MobileAPIError(
      'COUPON_CUSTOMER_LIMIT_REACHED',
      'You have already used this coupon.',
      409,
    )
  }
  const now = new Date().toISOString()
  return req.payload.create({
    collection: 'coupon-redemptions',
    data: {
      allocatedAt: now,
      amountPaise,
      coupon: coupon.id,
      customer: customerID,
      order: order.id,
      redeemedAt: redeemImmediately ? now : null,
      status: redeemImmediately ? 'redeemed' : 'allocated',
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
}

export const redeemOrderCoupon = async (req: PayloadRequest, orderID: number) => {
  const result = await req.payload.find({
    collection: 'coupon-redemptions',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { order: { equals: orderID } },
  })
  const redemption = result.docs[0]
  if (!redemption || redemption.status === 'redeemed') return
  if (redemption.status !== 'allocated')
    throw new MobileAPIError('COUPON_RELEASED', 'The coupon allocation is no longer active.', 409)
  await req.payload.update({
    collection: 'coupon-redemptions',
    id: redemption.id,
    data: { redeemedAt: new Date().toISOString(), status: 'redeemed' },
    depth: 0,
    overrideAccess: true,
    req,
  })
}

export const releaseOrderCoupon = async (req: PayloadRequest, orderID: number) => {
  const result = await req.payload.find({
    collection: 'coupon-redemptions',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { order: { equals: orderID } },
  })
  const redemption = result.docs[0]
  if (!redemption || redemption.status === 'released') return
  await req.payload.update({
    collection: 'coupon-redemptions',
    id: redemption.id,
    data: { releasedAt: new Date().toISOString(), status: 'released' },
    depth: 0,
    overrideAccess: true,
    req,
  })
}

/**
 * Whether the coupon still has uses left, globally and for this customer. Used when a coupon is
 * applied to a cart and when checkout is previewed, so customers learn about an exhausted code
 * immediately instead of at payment. allocateCoupon repeats the check under a row lock.
 */
export const assertCouponAvailable = async (
  req: PayloadRequest,
  coupon: Coupon,
  customerID: number | string,
): Promise<void> => {
  const activeStatuses = ['allocated', 'redeemed'] as const
  if (coupon.usageLimit != null) {
    const used = await req.payload.count({
      collection: 'coupon-redemptions',
      overrideAccess: true,
      req,
      where: { and: [{ coupon: { equals: coupon.id } }, { status: { in: [...activeStatuses] } }] },
    })
    if (used.totalDocs >= Number(coupon.usageLimit))
      throw new MobileAPIError('COUPON_LIMIT_REACHED', 'Coupon usage limit has been reached.', 422)
  }
  if (coupon.perCustomerLimit != null) {
    const mine = await req.payload.count({
      collection: 'coupon-redemptions',
      overrideAccess: true,
      req,
      where: {
        and: [
          { coupon: { equals: coupon.id } },
          { customer: { equals: customerID } },
          { status: { in: [...activeStatuses] } },
        ],
      },
    })
    if (mine.totalDocs >= Number(coupon.perCustomerLimit))
      throw new MobileAPIError(
        'COUPON_CUSTOMER_LIMIT_REACHED',
        'You have already used this coupon.',
        422,
      )
  }
}
