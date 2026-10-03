import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { orderStatuses } from './Orders'

export const OrderStatusEvents: CollectionConfig = {
  slug: 'order-status-events',
  admin: {
    group: 'Orders',
    defaultColumns: ['order', 'fromStatus', 'toStatus', 'actorType', 'occurredAt'],
    useAsTitle: 'order',
  },
  defaultSort: '-occurredAt',
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [{ fields: ['order', 'occurredAt'] }],
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    { name: 'fromStatus', type: 'select', options: [...orderStatuses] },
    { name: 'toStatus', type: 'select', required: true, options: [...orderStatuses] },
    { name: 'eventType', type: 'text', required: true, maxLength: 80 },
    {
      name: 'actorType',
      type: 'select',
      required: true,
      options: ['system', 'customer', 'admin', 'carrier'],
    },
    { name: 'actorId', type: 'text', maxLength: 120 },
    { name: 'reason', type: 'textarea', maxLength: 500 },
    { name: 'metadata', type: 'json' },
    { name: 'occurredAt', type: 'date', required: true, index: true },
  ],
  timestamps: true,
}
