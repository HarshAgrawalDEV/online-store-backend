import type { CollectionConfig } from 'payload'

import { denyAccess, readForActiveStaff } from '../access/catalog'

export const InventoryMovements: CollectionConfig = {
  slug: 'inventory-movements',
  labels: { singular: 'Inventory Movement', plural: 'Inventory Movements' },
  admin: {
    group: 'Inventory',
    defaultColumns: ['variant', 'quantityDelta', 'reason', 'performedBy', 'occurredAt'],
    useAsTitle: 'variant',
  },
  defaultSort: '-occurredAt',
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: readForActiveStaff,
    update: denyAccess,
  },
  fields: [
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
    },
    { name: 'quantityDelta', type: 'number', required: true },
    {
      name: 'reason',
      type: 'select',
      required: true,
      options: [
        'initial_stock',
        'manual_adjustment',
        'order_fulfilled',
        'order_cancelled',
        'return_restock',
        'damage',
      ],
    },
    { name: 'referenceType', type: 'text', maxLength: 80 },
    { name: 'referenceId', type: 'text', maxLength: 120 },
    { name: 'performedBy', type: 'relationship', relationTo: 'admins' },
    { name: 'note', type: 'textarea', maxLength: 500 },
    { name: 'occurredAt', type: 'date', required: true, index: true },
  ],
  timestamps: true,
}
