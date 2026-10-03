import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { ownerRead } from '../access/customers'
import { validateRequiredNonNegativeInteger } from '../lib/catalog'

export const CartItems: CollectionConfig = {
  slug: 'cart-items',
  admin: {
    group: 'Shopping',
    defaultColumns: ['cart', 'variant', 'quantity', 'updatedAt'],
    useAsTitle: 'id',
  },
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: ownerRead('cart.customer'),
    update: denyAccess,
  },
  indexes: [{ fields: ['cart', 'variant'], unique: true }],
  fields: [
    { name: 'cart', type: 'relationship', relationTo: 'carts', required: true, index: true },
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
    },
    {
      name: 'quantity',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
      validate: (value: number | null | undefined) => {
        const result = validateRequiredNonNegativeInteger(value)
        if (result !== true) return result
        return Number(value) >= 1 || 'Quantity must be at least 1.'
      },
    },
  ],
  timestamps: true,
}
