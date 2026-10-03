import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveCategories } from '../access/catalog'
import { preventCategoryCycles } from '../hooks/categories'
import { toSlug } from '../lib/catalog'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'parent', 'isActive', 'sortOrder'],
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
