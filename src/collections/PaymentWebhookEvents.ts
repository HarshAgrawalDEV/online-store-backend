import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'

export const PaymentWebhookEvents: CollectionConfig = {
  slug: 'payment-webhook-events',
  admin: {
    group: 'Payments',
    defaultColumns: ['provider', 'externalEventId', 'kind', 'status', 'processedAt'],
    useAsTitle: 'externalEventId',
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [{ fields: ['provider', 'externalEventId'], unique: true }],
  fields: [
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: ['razorpay', 'cashfree'],
      index: true,
    },
    { name: 'externalEventId', type: 'text', required: true, maxLength: 160 },
    { name: 'kind', type: 'text', required: true, maxLength: 120 },
    { name: 'signatureVerified', type: 'checkbox', required: true, defaultValue: false },
    { name: 'payloadRedacted', type: 'json' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'received',
      options: ['received', 'processed', 'ignored', 'failed'],
      index: true,
    },
    { name: 'processedAt', type: 'date' },
    { name: 'errorCode', type: 'text', maxLength: 100 },
  ],
  timestamps: true,
}
