import type { CollectionConfig } from 'payload'

import { canManageCatalog, denyAccess, readForActiveStaff } from '../access/catalog'

/**
 * What customers searched for and how many products it found. Rows are written only by the
 * server. No customer or device is recorded. Review the zero-result rows to find missing synonyms.
 */
export const SearchQueries: CollectionConfig = {
  slug: 'search-queries',
  labels: { singular: 'Search', plural: 'Search log' },
  admin: {
    group: 'Search',
    defaultColumns: ['query', 'resultCount', 'relaxed', 'createdAt'],
    useAsTitle: 'query',
    description:
      'Customer searches, newest first. Filter by result count 0 to see what was not found.',
  },
  access: {
    create: denyAccess,
    delete: canManageCatalog,
    read: readForActiveStaff,
    update: denyAccess,
  },
  defaultSort: '-createdAt',
  fields: [
    { name: 'query', type: 'text', required: true, maxLength: 120 },
    { name: 'normalizedQuery', type: 'text', required: true, index: true, maxLength: 120 },
    { name: 'resultCount', type: 'number', required: true, index: true, min: 0 },
    {
      name: 'relaxed',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: { description: 'Only some of the words matched.' },
    },
  ],
  timestamps: true,
}
