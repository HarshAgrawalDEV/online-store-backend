import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveLibraryItems } from '../access/catalog'
import { toSlug } from '../lib/catalog'

/** Glass, Lakh, Boor, Seep... Managed in the admin so a new material needs no code change. */
export const Materials: CollectionConfig = {
  slug: 'materials',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'code', 'isPremium', 'isActive', 'sortOrder'],
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
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      maxLength: 6,
      admin: { description: 'Short code used in SKUs, for example GLS, LAK, BOR, SEP.' },
      hooks: {
        beforeValidate: [
          ({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
        ],
      },
    },
    {
      name: 'isPremium',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: { description: 'Shown as the premium material in the app (for example Boor).' },
    },
    {
      name: 'description',
      type: 'textarea',
      maxLength: 500,
      admin: {
        description:
          'Customer-facing note about the material. For Boor describe it as a synthetic material; never mention real ivory or tusk.',
      },
    },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
    { name: 'sortOrder', type: 'number', defaultValue: 0, min: 0 },
  ],
  timestamps: true,
}
