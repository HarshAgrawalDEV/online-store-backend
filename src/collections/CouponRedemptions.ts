import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { validateRequiredNonNegativeInteger } from '../lib/catalog'

export const CouponRedemptions: CollectionConfig = {
  slug: 'coupon-redemptions',
  admin: {
    group: 'Shopping',
    defaultColumns: ['coupon', 'customer', 'order', 'status', 'amountPaise', 'redeemedAt'],
    useAsTitle: 'order',
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [{ fields: ['coupon', 'customer'] }],
  fields: [
    { name: 'coupon', type: 'relationship', relationTo: 'coupons', required: true, index: true },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'amountPaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: ['allocated', 'redeemed', 'released'],
      index: true,
    },
    { name: 'allocatedAt', type: 'date', required: true },
    { name: 'redeemedAt', type: 'date' },
    { name: 'releasedAt', type: 'date' },
  ],
  timestamps: true,
}
