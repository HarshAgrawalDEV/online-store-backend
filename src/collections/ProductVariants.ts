import type { CollectionConfig } from 'payload'

import { canManageCatalog, canReadCostField, readActiveVariants } from '../access/catalog'
import { normalizeVariant, preventDeletingLastActiveVariant } from '../hooks/variants'
import {
  validateOptionalNonNegativeInteger,
  validateRequiredNonNegativeInteger,
} from '../lib/catalog'

export const ProductVariants: CollectionConfig = {
  slug: 'product-variants',
  admin: {
    group: 'Catalog',
    defaultColumns: ['sku', 'product', 'sizeCode', 'colorCode', 'pricePaise', 'status'],
    useAsTitle: 'sku',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveVariants,
    update: canManageCatalog,
  },
  indexes: [
    { fields: ['product', 'optionSignature'], unique: true },
    { fields: ['product', 'status'] },
  ],
  hooks: {
    beforeChange: [normalizeVariant],
    beforeDelete: [preventDeletingLastActiveVariant],
  },
  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
    },
    { name: 'sku', type: 'text', required: true, unique: true, index: true, maxLength: 80 },
    { name: 'optionSignature', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'sizeCode', type: 'text', maxLength: 40 },
    { name: 'colorCode', type: 'text', index: true, maxLength: 60 },
    { name: 'finishCode', type: 'text', maxLength: 60 },
    {
      name: 'optionValues',
      type: 'array',
      fields: [
        {
          name: 'attribute',
          type: 'relationship',
          relationTo: 'catalog-attribute-definitions',
          required: true,
        },
        {
          name: 'option',
          type: 'relationship',
          relationTo: 'catalog-attribute-options',
          required: true,
          filterOptions: ({ siblingData }) => ({
            attribute: {
              equals:
                typeof siblingData === 'object' && siblingData && 'attribute' in siblingData
                  ? siblingData.attribute
                  : undefined,
            },
          }),
        },
      ],
    },
    {
      name: 'pricePaise',
      type: 'number',
      required: true,
      index: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'compareAtPricePaise',
      type: 'number',
      validate: (value: number | null | undefined, { siblingData }: { siblingData: unknown }) => {
        const integerValidation = validateOptionalNonNegativeInteger(value)
        if (integerValidation !== true) return integerValidation
        const pricePaise =
          typeof siblingData === 'object' && siblingData && 'pricePaise' in siblingData
            ? siblingData.pricePaise
            : undefined
        if (value != null && typeof pricePaise === 'number' && value < pricePaise) {
          return 'Compare-at price must be greater than or equal to the selling price.'
        }
        return true
      },
    },
    {
      name: 'costPaise',
      type: 'number',
      access: { read: canReadCostField },
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'inactive', 'discontinued'],
      index: true,
    },
    { name: 'barcode', type: 'text', unique: true, index: true, maxLength: 80 },
    { name: 'weightGrams', type: 'number', min: 0 },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'maxPerOrder',
      type: 'number',
      defaultValue: 10,
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'inventory',
      type: 'join',
      collection: 'inventory',
      on: 'variant',
      defaultLimit: 1,
    },
  ],
  timestamps: true,
}
