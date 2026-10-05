import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveLibraryItems } from '../access/catalog'
import { toSlug } from '../lib/catalog'

/** Festivals and seasons that shoppers filter by (wedding season, Teej, daily wear...). */
export const Occasions: CollectionConfig = {
  slug: 'occasions',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'sortOrder', 'isActive'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveLibraryItems,
    update: canManageCatalog,
  },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, maxLength: 80 },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [
          ({ siblingData, value }) => toSlug(String(value || siblingData.name || '')),
        ],
      },
    },
    { name: 'sortOrder', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
