import type { CollectionConfig } from 'payload'

import { commerceServiceOnly, readCommerceForStaff } from '../access/commerce'
import { validateRequiredNonNegativeInteger, validateRequiredPositiveInteger } from '../lib/catalog'

export const OrderItems: CollectionConfig = {
  slug: 'order-items',
  admin: {
    group: 'Orders',
    useAsTitle: 'skuSnapshot',
    defaultColumns: ['order', 'skuSnapshot', 'productNameSnapshot', 'quantity', 'lineTotalPaise'],
  },
  access: {
    create: commerceServiceOnly,
    delete: commerceServiceOnly,
    read: readCommerceForStaff,
    update: commerceServiceOnly,
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    { name: 'product', type: 'relationship', relationTo: 'products' },
    { name: 'variant', type: 'relationship', relationTo: 'product-variants' },
    { name: 'skuSnapshot', type: 'text', required: true, maxLength: 100 },
    { name: 'productNameSnapshot', type: 'text', required: true, maxLength: 180 },
    { name: 'sizeSnapshot', type: 'text', maxLength: 60 },
    { name: 'colorSnapshot', type: 'text', maxLength: 60 },
    {
      name: 'descriptionSnapshot',
      type: 'text',
      maxLength: 300,
      admin: { description: 'What was bought, as shown on packing paperwork.' },
    },
    { name: 'imageUrlSnapshot', type: 'text', maxLength: 500 },
    { name: 'quantity', type: 'number', required: true, validate: validateRequiredPositiveInteger },
    {
      name: 'unitPricePaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'unitDiscountPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'lineSubtotalPaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'lineDiscountPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'lineTaxPaise',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'lineTotalPaise',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
  ],
  timestamps: true,
}
