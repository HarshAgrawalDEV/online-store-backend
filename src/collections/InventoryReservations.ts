import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { validateRequiredPositiveInteger } from '../lib/catalog'

export const InventoryReservations: CollectionConfig = {
  slug: 'inventory-reservations',
  admin: {
    group: 'Inventory',
    defaultColumns: ['order', 'variant', 'quantity', 'status', 'expiresAt'],
    useAsTitle: 'order',
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  indexes: [{ fields: ['order', 'variant'], unique: true }, { fields: ['status', 'expiresAt'] }],
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
    },
    { name: 'quantity', type: 'number', required: true, validate: validateRequiredPositiveInteger },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'committed', 'released', 'expired'],
      index: true,
    },
    { name: 'expiresAt', type: 'date', required: true, index: true },
    { name: 'releasedAt', type: 'date' },
    { name: 'committedAt', type: 'date' },
  ],
  timestamps: true,
}
