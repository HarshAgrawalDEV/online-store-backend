import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { validateRequiredPositiveInteger } from '../lib/catalog'
import { paymentMethods } from './Orders'

export const PaymentAttempts: CollectionConfig = {
  slug: 'payment-attempts',
  admin: {
    group: 'Payments',
    defaultColumns: ['order', 'provider', 'paymentMethod', 'status', 'amountPaise', 'initiatedAt'],
    useAsTitle: 'idempotencyKey',
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [{ fields: ['order', 'status'] }],
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: ['razorpay', 'cashfree', 'manual_cod'],
      index: true,
    },
    { name: 'paymentMethod', type: 'select', required: true, options: [...paymentMethods] },
    { name: 'providerOrderId', type: 'text', unique: true, index: true, maxLength: 120 },
    { name: 'providerPaymentId', type: 'text', unique: true, index: true, maxLength: 120 },
    {
      name: 'idempotencyKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 140,
    },
    {
      name: 'amountPaise',
      type: 'number',
      required: true,
      validate: validateRequiredPositiveInteger,
    },
    { name: 'currency', type: 'select', required: true, defaultValue: 'INR', options: ['INR'] },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'created',
      options: ['created', 'pending', 'authorized', 'paid', 'failed', 'expired', 'cancelled'],
      index: true,
    },
    { name: 'failureCode', type: 'text', maxLength: 100 },
    { name: 'failureMessage', type: 'textarea', maxLength: 500 },
    { name: 'initiatedAt', type: 'date', required: true },
    { name: 'completedAt', type: 'date' },
    { name: 'lastVerifiedAt', type: 'date' },
  ],
  timestamps: true,
}
