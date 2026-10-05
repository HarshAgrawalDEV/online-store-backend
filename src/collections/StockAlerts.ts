import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { ownerRead } from '../access/customers'

/**
 * A customer asking to be told when a sold-out size and colour is back. Rows are only created and
 * removed through the customer endpoints; staff can read them to see which options people are waiting for.
 */
export const StockAlerts: CollectionConfig = {
  slug: 'stock-alerts',
  labels: { singular: 'Stock alert', plural: 'Stock alerts' },
  admin: {
    group: 'Inventory',
    defaultColumns: ['variant', 'customer', 'createdAt'],
    description: 'Customers waiting for a sold-out option. Use it to decide what to restock first.',
    useAsTitle: 'id',
  },
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: ownerRead('customer'),
    update: denyAccess,
  },
  indexes: [{ fields: ['customer', 'variant'], unique: true }],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
    },
  ],
  timestamps: true,
}
