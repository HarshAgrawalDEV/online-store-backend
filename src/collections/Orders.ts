import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { validateRequiredNonNegativeInteger } from '../lib/catalog'

export const orderStatuses = [
  'pending_payment',
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const
export const paymentStatuses = [
  'unpaid',
  'pending',
  'paid',
  'partially_refunded',
  'refunded',
  'failed',
] as const
export const paymentMethods = ['upi', 'card', 'netbanking', 'wallet', 'cod'] as const

export const Orders: CollectionConfig = {
  slug: 'orders',
  admin: {
    group: 'Orders',
    useAsTitle: 'orderNumber',
    defaultColumns: [
      'orderNumber',
      'customer',
      'status',
      'paymentStatus',
      'grandTotalPaise',
      'placedAt',
    ],
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [
    { fields: ['customer', 'idempotencyKey'], unique: true },
    { fields: ['customer', 'placedAt'] },
    { fields: ['status', 'placedAt'] },
  ],
  fields: [
    { name: 'orderNumber', type: 'text', required: true, unique: true, index: true, maxLength: 40 },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    { name: 'cart', type: 'relationship', relationTo: 'carts', unique: true },
    { name: 'idempotencyKey', type: 'text', required: true, maxLength: 120 },
    { name: 'requestHash', type: 'text', required: true, maxLength: 64, admin: { hidden: true } },
    { name: 'status', type: 'select', required: true, options: [...orderStatuses], index: true },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      options: [...paymentStatuses],
      index: true,
    },
    {
      name: 'fulfillmentStatus',
      type: 'select',
      required: true,
      defaultValue: 'unfulfilled',
      options: ['unfulfilled', 'partial', 'fulfilled', 'returned'],
      index: true,
    },
    { name: 'paymentMethod', type: 'select', required: true, options: [...paymentMethods] },
    { name: 'currency', type: 'select', required: true, defaultValue: 'INR', options: ['INR'] },
    {
      name: 'itemsSubtotalPaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'discountPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'shippingPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'taxPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'codFeePaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'grandTotalPaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    { name: 'shippingAddressSnapshot', type: 'json', required: true },
    { name: 'billingAddressSnapshot', type: 'json' },
    { name: 'pricingBreakdown', type: 'json' },
    { name: 'couponCodeSnapshot', type: 'text', maxLength: 40 },
    { name: 'customerNote', type: 'textarea', maxLength: 500 },
    { name: 'exceptionCode', type: 'text', maxLength: 80, admin: { readOnly: true } },
    { name: 'placedAt', type: 'date', required: true, index: true },
    { name: 'confirmedAt', type: 'date' },
    { name: 'cancelledAt', type: 'date' },
  ],
  timestamps: true,
}
