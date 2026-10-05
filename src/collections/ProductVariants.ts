import type { CollectionConfig } from 'payload'

import { canManageCatalog, canReadCostField, readActiveVariants } from '../access/catalog'
import {
  normalizeVariant,
  preventDeletingLastActiveVariant,
  prepareVariant,
} from '../hooks/variants'
import {
  validateOptionalNonNegativeInteger,
  validateRequiredNonNegativeInteger,
} from '../lib/catalog'

export const ProductVariants: CollectionConfig = {
  slug: 'product-variants',
  admin: {
    group: 'Catalog',
    defaultColumns: ['sku', 'product', 'sizeLabel', 'colourLabel', 'pricePaise', 'status'],
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
    beforeValidate: [prepareVariant],
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
    {
      name: 'sku',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 80,
      admin: { description: 'Leave empty to generate one, for example GLS-BNG12-014-TEAL-24.' },
    },
    { name: 'optionSignature', type: 'text', required: true, admin: { readOnly: true } },
    {
      name: 'size',
      type: 'relationship',
      relationTo: 'sizes',
      index: true,
      admin: { description: 'Choose from the size list.' },
    },
    {
      name: 'colour',
      type: 'relationship',
      relationTo: 'colours',
      index: true,
      admin: { description: 'Choose from the shared colour library.' },
    },
    {
      name: 'customColourName',
      type: 'text',
      maxLength: 60,
      admin: {
        description:
          'A one-off colour that is not in the library. It shows on this product only until it is saved to the library.',
        condition: (data) => !data?.colour,
      },
    },
    {
      name: 'saveToColourLibrary',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Tick and save to add the custom colour to the library for every product.',
        condition: (data) => !data?.colour && Boolean(data?.customColourName),
      },
    },
    { name: 'sizeCode', type: 'text', maxLength: 40, admin: { readOnly: true } },
    { name: 'sizeLabel', type: 'text', maxLength: 40, admin: { readOnly: true } },
    { name: 'colorCode', type: 'text', index: true, maxLength: 60, admin: { readOnly: true } },
    { name: 'colourLabel', type: 'text', maxLength: 80, admin: { readOnly: true } },
    { name: 'finishCode', type: 'text', maxLength: 60 },
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
