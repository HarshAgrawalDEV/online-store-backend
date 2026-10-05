import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveCategories } from '../access/catalog'
import { preventCategoryCycles } from '../hooks/categories'
import { toSlug } from '../lib/catalog'
import { departmentLabels, departments } from '../lib/jewellery'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'department', 'parent', 'isActive', 'sortOrder'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveCategories,
    update: canManageCatalog,
  },
  hooks: {
    beforeChange: [preventCategoryCycles],
  },
  fields: [
    {
      name: 'department',
      type: 'select',
      required: true,
      defaultValue: 'bangles',
      index: true,
      options: departments.map((value) => ({ label: departmentLabels[value], value })),
      admin: {
        description:
          'Bangles and Jewellery are separate departments in the app. A product can only be in a category of its own department.',
      },
    },
    {
      name: 'skuCode',
      type: 'text',
      maxLength: 4,
      admin: {
        description:
          'Jewellery only: 2 to 4 letters used at the start of item codes, for example NKS for Necklace Sets.',
      },
      hooks: {
        beforeValidate: [
          ({ value }) =>
            value
              ? String(value)
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
              : value,
        ],
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      maxLength: 120,
    },
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
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      index: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'description',
      type: 'textarea',
      maxLength: 1000,
    },
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
    },
    {
      type: 'group',
      name: 'seo',
      fields: [
        { name: 'title', type: 'text', maxLength: 70 },
        { name: 'description', type: 'textarea', maxLength: 170 },
      ],
    },
  ],
  timestamps: true,
}
