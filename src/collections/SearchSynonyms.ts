import type { CollectionConfig } from 'payload'

import { canManageCatalog, readForActiveStaff } from '../access/catalog'

/**
 * Words customers use for the same thing (kada, kara, kangan). Search treats every word in a
 * group as a match for the others. Built-in groups live in the code; these are staff additions.
 */
export const SearchSynonyms: CollectionConfig = {
  slug: 'search-synonyms',
  labels: { singular: 'Search synonym group', plural: 'Search synonyms' },
  admin: {
    group: 'Search',
    defaultColumns: ['label', 'terms', 'isActive'],
    useAsTitle: 'label',
    description:
      'Add the different words customers type for the same thing, for example kada, kara, kangan.',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readForActiveStaff,
    update: canManageCatalog,
  },
  fields: [
    { name: 'label', type: 'text', required: true, maxLength: 80 },
    {
      name: 'terms',
      type: 'array',
      required: true,
      minRows: 2,
      maxRows: 30,
      labels: { singular: 'Word', plural: 'Words' },
      fields: [{ name: 'term', type: 'text', required: true, maxLength: 60 }],
    },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
