import type { CollectionConfig } from 'payload'

import { canManageCatalog } from '../access/catalog'
import { normalizeCode } from '../lib/catalog'

export const CatalogAttributeDefinitions: CollectionConfig = {
  slug: 'catalog-attribute-definitions',
  labels: { singular: 'Attribute Definition', plural: 'Attribute Definitions' },
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'code', 'scope', 'valueType', 'filterable'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: () => true,
    update: canManageCatalog,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 100 },
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: { beforeValidate: [({ value }) => normalizeCode(String(value || ''))] },
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      options: ['product', 'variant'],
    },
    {
      name: 'valueType',
      type: 'select',
      required: true,
      options: ['select', 'multi_select', 'text'],
    },
    { name: 'filterable', type: 'checkbox', required: true, defaultValue: false },
    { name: 'sortOrder', type: 'number', defaultValue: 0, min: 0 },
  ],
  timestamps: true,
}
