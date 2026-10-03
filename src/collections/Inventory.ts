import type { CollectionConfig } from 'payload'

import { canManageInventory, denyAccess, readForActiveStaff } from '../access/catalog'
import { recordInventoryMovement, validateInventoryBalance } from '../hooks/inventory'
import { validateRequiredNonNegativeInteger } from '../lib/catalog'

export const Inventory: CollectionConfig = {
  slug: 'inventory',
  labels: { singular: 'Inventory Record', plural: 'Inventory' },
  admin: {
    group: 'Inventory',
    defaultColumns: ['variant', 'onHand', 'reserved', 'available', 'stockStatus', 'reorderPoint'],
    useAsTitle: 'variant',
  },
  access: {
    create: canManageInventory,
    delete: denyAccess,
    read: readForActiveStaff,
    update: canManageInventory,
  },
  hooks: {
    beforeChange: [validateInventoryBalance],
    afterChange: [recordInventoryMovement],
  },
  fields: [
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'onHand',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'reserved',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'available',
      type: 'number',
      virtual: true,
      admin: { readOnly: true },
      hooks: {
        afterRead: [
          ({ siblingData }) =>
            Math.max(0, Number(siblingData.onHand) - Number(siblingData.reserved)),
        ],
      },
    },
    {
      name: 'reorderPoint',
      type: 'number',
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'stockStatus',
      type: 'select',
      required: true,
      defaultValue: 'available',
      options: ['available', 'out_of_stock', 'paused'],
      index: true,
    },
  ],
  timestamps: true,
}
