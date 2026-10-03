import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveProducts } from '../access/catalog'
import { enforceProductPublication } from '../hooks/products'
import { toSlug, validateOptionalNonNegativeInteger } from '../lib/catalog'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'primaryCategory', 'isFeatured', 'publishedAt'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveProducts,
    update: canManageCatalog,
  },
  indexes: [{ fields: ['status', 'primaryCategory', 'publishedAt'] }],
  hooks: {
    beforeChange: [enforceProductPublication],
  },
  fields: [
    { name: 'name', type: 'text', required: true, index: true, maxLength: 180 },
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
    { name: 'shortDescription', type: 'textarea', maxLength: 500 },
    { name: 'description', type: 'richText' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: ['draft', 'active', 'archived'],
      index: true,
    },
    {
      name: 'primaryCategory',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      index: true,
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
    },
    {
      name: 'collections',
      type: 'relationship',
      relationTo: 'collections',
      hasMany: true,
    },
    {
      name: 'jewelryDetails',
      type: 'group',
      fields: [
        { name: 'brand', type: 'text', defaultValue: 'Rajasthan Jewelry', maxLength: 120 },
        { name: 'material', type: 'text', index: true, maxLength: 100 },
        { name: 'plating', type: 'text', maxLength: 100 },
        { name: 'stoneType', type: 'text', maxLength: 100 },
      ],
    },
    {
      name: 'styleTags',
      type: 'array',
      fields: [{ name: 'label', type: 'text', required: true, maxLength: 80 }],
    },
    {
      name: 'occasions',
      type: 'array',
      fields: [
        {
          name: 'occasion',
          type: 'select',
          required: true,
          options: ['wedding', 'haldi', 'mehendi', 'diwali', 'festive', 'everyday', 'gifting'],
        },
      ],
    },
    {
      name: 'specifications',
      type: 'array',
      fields: [
        { name: 'name', type: 'text', required: true, maxLength: 80 },
        { name: 'value', type: 'text', required: true, maxLength: 200 },
      ],
    },
    { name: 'careInstructions', type: 'richText' },
    { name: 'isReturnable', type: 'checkbox', required: true, defaultValue: true },
    {
      name: 'returnWindowDays',
      type: 'number',
      validate: validateOptionalNonNegativeInteger,
    },
    { name: 'weightGrams', type: 'number', min: 0 },
    { name: 'hsnCode', type: 'text', maxLength: 20 },
    { name: 'taxClass', type: 'select', options: ['standard', 'exempt', 'custom'] },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    {
      name: 'gallery',
      type: 'array',
      admin: { description: 'Ordered product and variant imagery.' },
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
        { name: 'variant', type: 'relationship', relationTo: 'product-variants' },
        { name: 'caption', type: 'text', maxLength: 240 },
        { name: 'sortOrder', type: 'number', required: true, defaultValue: 0, min: 0 },
      ],
    },
    { name: 'isFeatured', type: 'checkbox', required: true, defaultValue: false, index: true },
    { name: 'publishedAt', type: 'date', index: true, admin: { readOnly: true } },
    {
      name: 'seo',
      type: 'group',
      fields: [
        { name: 'title', type: 'text', maxLength: 70 },
        { name: 'description', type: 'textarea', maxLength: 170 },
      ],
    },
    {
      name: 'variants',
      type: 'join',
      collection: 'product-variants',
      on: 'product',
      defaultLimit: 50,
    },
  ],
  timestamps: true,
}
