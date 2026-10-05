import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveProducts } from '../access/catalog'
import { assignDesignNumber, enforceProductPublication } from '../hooks/products'
import { toSlug, validateOptionalNonNegativeInteger } from '../lib/catalog'
import {
  baseMetals,
  departmentLabels,
  departments,
  fitOptions,
  wearOptions,
} from '../lib/jewellery'
import { productTypeLabels, productTypes } from '../lib/set-details'

/**
 * The product screen is split into tabs by job, in the order staff work:
 * Basics, What is sold, Variants, Photos, Description, More. Names are kept short so all tabs fit without scrolling.
 * The tabs have no names of their own, so the stored data keeps the same flat shape.
 */
export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'material', 'primaryCategory', 'isFeatured', 'publishedAt'],
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
    beforeValidate: [assignDesignNumber],
    beforeChange: [enforceProductPublication],
  },
  fields: [
    // Sidebar: what staff check at a glance.
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft (hidden from customers)', value: 'draft' },
        { label: 'Active (visible in the app)', value: 'active' },
        { label: 'Archived (hidden)', value: 'archived' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'To make it active it needs a photo, material, what is sold, and at least one active variant.',
      },
    },
    {
      name: 'designNumber',
      type: 'number',
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Assigned automatically and never reused. Appears in SKUs.',
      },
    },
    {
      name: 'isFeatured',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      admin: { position: 'sidebar', description: 'Show a "Featured" badge.' },
    },
    {
      name: 'publishedAt',
      type: 'date',
      index: true,
      admin: { readOnly: true, position: 'sidebar' },
    },

    // Step 1: which department. It decides which details the rest of the screen asks for.
    {
      name: 'department',
      type: 'select',
      required: true,
      defaultValue: 'bangles',
      index: true,
      options: departments.map((value) => ({ label: departmentLabels[value], value })),
      admin: {
        description:
          'Choose this first. Bangles (glass, lakh, boor, seep, chuda) and Jewellery (necklace sets, earrings, nath…) ask for different details.',
      },
    },

    // Always on top: the name.
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          index: true,
          maxLength: 180,
          admin: { width: '60%' },
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
          unique: true,
          index: true,
          admin: { width: '40%', description: 'Web address part. Filled in from the name.' },
          hooks: {
            beforeValidate: [
              ({ siblingData, value }) => toSlug(String(value || siblingData.name || '')),
            ],
          },
        },
      ],
    },

    {
      name: 'duplicateNameWarning',
      type: 'ui',
      admin: { components: { Field: '/components/ProductTools#DuplicateNameWarning' } },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Basics',
          description: 'Where it is listed and what it is made of.',
          fields: [
            {
              name: 'primaryCategory',
              type: 'relationship',
              relationTo: 'categories',
              required: true,
              index: true,
              filterOptions: ({ data }) => ({
                department: { equals: data?.department ?? 'bangles' },
              }),
              admin: {
                description: 'The main shelf. Only categories of the chosen department are listed.',
              },
            },
            {
              name: 'material',
              type: 'relationship',
              relationTo: 'materials',
              index: true,
              admin: {
                condition: (data) => data?.department !== 'jewellery',
                description: 'Bangles only. Required before the product can be published.',
              },
            },
            {
              name: 'occasions',
              type: 'relationship',
              relationTo: 'occasions',
              hasMany: true,
              admin: {
                description: 'Festivals and seasons this suits. Used by the Occasion filter.',
              },
            },
            {
              name: 'categories',
              type: 'relationship',
              relationTo: 'categories',
              hasMany: true,
              admin: { description: 'Optional: extra shelves to also list it under.' },
            },
            {
              name: 'collections',
              type: 'relationship',
              relationTo: 'collections',
              hasMany: true,
              admin: { description: 'Optional: curated collections such as Wedding Guest.' },
            },
            {
              name: 'shortDescription',
              type: 'textarea',
              maxLength: 500,
              admin: {
                description:
                  'One or two lines shown under the name. Also used as a hint when writing an AI description.',
              },
            },
          ],
        },
        {
          label: 'What is sold',
          description: 'Every item is for both hands, so the total is always even.',
          fields: [
            {
              name: 'jewellery',
              type: 'group',
              label: false,
              admin: {
                condition: (data) => data?.department === 'jewellery',
                description:
                  'List every part the customer receives. One part is a single piece; more than one is a set.',
              },
              fields: [
                {
                  name: 'components',
                  type: 'array',
                  label: 'Parts included',
                  labels: { plural: 'Parts', singular: 'Part' },
                  admin: { initCollapsed: false },
                  fields: [
                    {
                      type: 'row',
                      fields: [
                        {
                          name: 'piece',
                          type: 'relationship',
                          relationTo: 'piece-types',
                          required: true,
                          admin: {
                            width: '70%',
                            description: 'For example Necklace, Earrings, Maang tikka.',
                          },
                        },
                        {
                          name: 'quantity',
                          type: 'number',
                          required: true,
                          defaultValue: 1,
                          min: 1,
                          max: 10,
                          admin: { width: '30%', description: 'A pair of earrings is 1.' },
                        },
                      ],
                    },
                  ],
                },
                {
                  name: 'finish',
                  type: 'relationship',
                  relationTo: 'finishes',
                  admin: {
                    description: 'The polish. Required before the product can be published.',
                  },
                },
                {
                  name: 'styles',
                  type: 'relationship',
                  relationTo: 'jewellery-styles',
                  hasMany: true,
                  admin: { description: 'Kundan-look, pearl, temple… pick all that fit.' },
                },
                {
                  name: 'stoneTypes',
                  type: 'relationship',
                  relationTo: 'stone-types',
                  hasMany: true,
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'wear',
                      type: 'select',
                      options: [...wearOptions],
                      admin: { width: '33%', description: 'Earrings and nose ornaments.' },
                    },
                    {
                      name: 'fit',
                      type: 'select',
                      options: [...fitOptions],
                      admin: { width: '33%' },
                    },
                    {
                      name: 'baseMetal',
                      type: 'select',
                      options: [...baseMetals],
                      admin: { width: '34%' },
                    },
                  ],
                },
              ],
            },
            {
              name: 'setDetails',
              type: 'group',
              label: false,
              admin: {
                condition: (data) => data?.department !== 'jewellery',
                description:
                  'Chuda: enter the total for both hands (5 per hand = 10). Kada pair is always 2 kadas. A complete set is 2 kadas plus bangles.',
              },
              fields: [
                {
                  name: 'productType',
                  type: 'select',
                  options: productTypes.map((value) => ({
                    label: productTypeLabels[value],
                    value,
                  })),
                  index: true,
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'piecesTotal',
                      type: 'number',
                      min: 2,
                      admin: { width: '50%', description: 'Total pieces in the set, both hands.' },
                    },
                    {
                      name: 'kadaCount',
                      type: 'number',
                      min: 0,
                      admin: {
                        width: '50%',
                        description: 'Kadas in the set. Kada pair and complete set always have 2.',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Variants',
          description: 'Create every size and colour in one go, then check the list below.',
          fields: [
            {
              name: 'variantTools',
              type: 'ui',
              admin: { components: { Field: '/components/ProductTools#VariantTools' } },
            },
            {
              name: 'variants',
              type: 'join',
              collection: 'product-variants',
              on: 'product',
              defaultLimit: 50,
              admin: {
                description:
                  'Each row is one size and colour with its own price and SKU. Open a row to change its price, or set its status to inactive to hide it. Stock is managed under Inventory.',
              },
            },
          ],
        },
        {
          label: 'Photos',
          fields: [
            {
              name: 'featuredImage',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description: 'The main photo. Shown on cards and first on the product page.',
              },
            },
            {
              name: 'gallery',
              type: 'array',
              admin: {
                description:
                  'More photos in the order shown. Link a photo to a variant to show it when that colour is chosen.',
              },
              fields: [
                { name: 'image', type: 'upload', relationTo: 'media', required: true },
                { name: 'variant', type: 'relationship', relationTo: 'product-variants' },
                { name: 'caption', type: 'text', maxLength: 240 },
                { name: 'sortOrder', type: 'number', required: true, defaultValue: 0, min: 0 },
              ],
            },
          ],
        },
        {
          label: 'Description',
          description: 'What customers read on the product page.',
          fields: [
            {
              name: 'descriptionTools',
              type: 'ui',
              admin: { components: { Field: '/components/ProductTools#DescriptionTools' } },
            },
            { name: 'description', type: 'richText' },
            {
              name: 'aiDraft',
              type: 'group',
              admin: {
                description:
                  'The last machine-written draft. It is only a draft: it is never shown to customers until you use it as the description.',
              },
              fields: [
                { name: 'text', type: 'textarea', maxLength: 2000 },
                { name: 'model', type: 'text', admin: { readOnly: true } },
                { name: 'generatedAt', type: 'date', admin: { readOnly: true } },
              ],
            },
          ],
        },
        {
          label: 'More',
          description: 'Optional extras. Most products only need a few of these.',
          fields: [
            {
              name: 'specifications',
              type: 'array',
              admin: {
                description: 'Extra facts shown in "Product details", e.g. Finish: Sparkle.',
              },
              fields: [
                { name: 'name', type: 'text', required: true, maxLength: 80 },
                { name: 'value', type: 'text', required: true, maxLength: 200 },
              ],
            },
            {
              name: 'styleTags',
              type: 'array',
              fields: [{ name: 'label', type: 'text', required: true, maxLength: 80 }],
            },
            { name: 'careInstructions', type: 'richText' },
            {
              type: 'row',
              fields: [
                { name: 'isReturnable', type: 'checkbox', required: true, defaultValue: true },
                {
                  name: 'returnWindowDays',
                  type: 'number',
                  validate: validateOptionalNonNegativeInteger,
                },
                { name: 'weightGrams', type: 'number', min: 0 },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'hsnCode', type: 'text', maxLength: 20 },
                { name: 'taxClass', type: 'select', options: ['standard', 'exempt', 'custom'] },
              ],
            },
            {
              name: 'seo',
              type: 'group',
              label: 'Search engine listing (optional)',
              fields: [
                { name: 'title', type: 'text', maxLength: 70 },
                { name: 'description', type: 'textarea', maxLength: 170 },
              ],
            },
          ],
        },
      ],
    },
  ],
  timestamps: true,
}
