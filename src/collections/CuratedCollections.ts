import type { CollectionConfig } from 'payload'

import { canManageCatalog, readPublishedCollections } from '../access/catalog'
import { toSlug } from '../lib/catalog'

export const CuratedCollections: CollectionConfig = {
  slug: 'collections',
  labels: {
    singular: 'Curated Collection',
    plural: 'Curated Collections',
  },
  admin: {
    group: 'Catalog',
    defaultColumns: ['title', 'occasion', 'isPublished', 'sortOrder'],
    useAsTitle: 'title',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readPublishedCollections,
    update: canManageCatalog,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data?.startsAt && data.endsAt && new Date(data.startsAt) >= new Date(data.endsAt)) {
          throw new Error('Collection start time must be earlier than its end time.')
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 140,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [
          ({ siblingData, value }) => toSlug(String(value || siblingData.title || '')),
        ],
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      maxLength: 500,
    },
    {
      name: 'heroImage',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'occasion',
      type: 'select',
      options: ['wedding', 'haldi', 'mehendi', 'diwali', 'festive', 'everyday', 'gifting'],
      index: true,
    },
    {
      name: 'isPublished',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
    },
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    { name: 'startsAt', type: 'date' },
    { name: 'endsAt', type: 'date' },
    {
      name: 'products',
      type: 'join',
      collection: 'products',
      on: 'collections',
      defaultLimit: 20,
    },
  ],
  timestamps: true,
}
