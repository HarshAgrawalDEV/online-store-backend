import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { ownerRead } from '../access/customers'

export const Wishlists: CollectionConfig = {
  slug: 'wishlists',
  admin: { group: 'Customers', useAsTitle: 'name' },
  access: {
    create: denyAccess,
    delete: denyAccess,
    read: ownerRead('customer'),
    update: denyAccess,
  },
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      unique: true,
      index: true,
    },
    { name: 'name', type: 'text', required: true, defaultValue: 'Saved Items', maxLength: 80 },
    { name: 'items', type: 'join', collection: 'wishlist-items', on: 'wishlist' },
  ],
  timestamps: true,
}
