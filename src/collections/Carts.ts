import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { ownerRead } from '../access/customers'

export const Carts: CollectionConfig = {
  slug: 'carts',
  admin: {
    group: 'Shopping',
    defaultColumns: ['customer', 'status', 'currency', 'coupon', 'updatedAt'],
    useAsTitle: 'id',
  },
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: ownerRead('customer'),
    update: denyAccess,
  },
  indexes: [{ fields: ['customer', 'status'] }],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'converted', 'abandoned', 'expired'],
      index: true,
    },
    { name: 'currency', type: 'select', required: true, defaultValue: 'INR', options: ['INR'] },
    { name: 'coupon', type: 'relationship', relationTo: 'coupons' },
    { name: 'convertedOrder', type: 'relationship', relationTo: 'orders', unique: true },
    { name: 'items', type: 'join', collection: 'cart-items', on: 'cart', defaultLimit: 100 },
  ],
  timestamps: true,
}
