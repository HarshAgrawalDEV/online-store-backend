import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveLibraryItems } from '../access/catalog'

/** Indian bangle sizes such as 2-4. They are labels, never decimals: 2-10 is not 2.1. */
export const Sizes: CollectionConfig = {
  slug: 'sizes',
  admin: {
    group: 'Catalog',
    defaultColumns: ['label', 'innerDiameterMm', 'sortOrder', 'isActive'],
    useAsTitle: 'label',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveLibraryItems,
    update: canManageCatalog,
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      maxLength: 20,
      admin: { description: 'For example 2-4. Used in SKUs and filters.' },
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim() : value)],
      },
    },
    {
      name: 'label',
      type: 'text',
      required: true,
      maxLength: 20,
      hooks: {
        beforeValidate: [
          ({ siblingData, value }) => String(value || siblingData.code || '').trim(),
        ],
      },
    },
    {
      name: 'innerDiameterMm',
      type: 'number',
      min: 0,
      admin: { description: 'Inner diameter in millimetres, shown in the size guide.' },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: { description: 'Display order: smaller sizes first.' },
    },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
