import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveAttributeOptions } from '../access/catalog'
import { normalizeCode, validateOptionalHexColor } from '../lib/catalog'

export const CatalogAttributeOptions: CollectionConfig = {
  slug: 'catalog-attribute-options',
  labels: { singular: 'Attribute Option', plural: 'Attribute Options' },
  admin: {
    group: 'Catalog',
    defaultColumns: ['label', 'attribute', 'code', 'isActive'],
    useAsTitle: 'label',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveAttributeOptions,
    update: canManageCatalog,
  },
  indexes: [{ fields: ['attribute', 'code'], unique: true }],
  fields: [
    {
      name: 'attribute',
      type: 'relationship',
      relationTo: 'catalog-attribute-definitions',
      required: true,
      index: true,
    },
    {
      name: 'code',
      type: 'text',
      required: true,
      hooks: { beforeValidate: [({ value }) => normalizeCode(String(value || ''))] },
    },
    { name: 'label', type: 'text', required: true, maxLength: 100 },
    { name: 'swatchHex', type: 'text', validate: validateOptionalHexColor },
    { name: 'sortOrder', type: 'number', defaultValue: 0, min: 0 },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true },
  ],
  timestamps: true,
}
