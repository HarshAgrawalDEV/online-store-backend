import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { ownerRead } from '../access/customers'

export const WishlistItems: CollectionConfig = {
  slug: 'wishlist-items',
  admin: { group: 'Customers', useAsTitle: 'id' },
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: ownerRead('wishlist.customer'),
    update: denyAccess,
  },
  indexes: [{ fields: ['wishlist', 'product'], unique: true }],
  fields: [
    {
      name: 'wishlist',
      type: 'relationship',
      relationTo: 'wishlists',
      required: true,
      index: true,
    },
    { name: 'product', type: 'relationship', relationTo: 'products', required: true, index: true },
  ],
  timestamps: true,
}
