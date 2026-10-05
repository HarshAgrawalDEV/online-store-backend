import type { CollectionConfig, Field } from 'payload'

import { canManageCatalog, readActiveLibraryItems } from '../access/catalog'
import { toSlug } from '../lib/catalog'

/** Small shared lists the shop edits itself, in the same shape as Occasions. */
const library = (
  slug: string,
  labels: { plural: string; singular: string },
  description: string,
  extraFields: Field[] = [],
): CollectionConfig => ({
  slug,
  labels,
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'sortOrder', 'isActive'],
    description,
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveLibraryItems,
    update: canManageCatalog,
  },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, maxLength: 80 },
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
    ...extraFields,
    { name: 'sortOrder', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
})

export const PieceTypes = library(
  'piece-types',
  { plural: 'Piece types', singular: 'Piece type' },
  'The parts a jewellery set is made of: necklace, earrings, maang tikka, nath, besar, loom… Name them the way you sell them.',
  [
    {
      name: 'soldAsPair',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: { description: 'Tick for things that come as a pair, such as earrings or bajuband.' },
    },
  ],
)

export const JewelleryStyles = library(
  'jewellery-styles',
  { plural: 'Jewellery styles', singular: 'Jewellery style' },
  'How a design looks: kundan-look, polki-look, jadau-look, meenakari, temple, pearl, oxidised…',
)

export const Finishes = library(
  'finishes',
  { plural: 'Finishes', singular: 'Finish' },
  'The polish on the metal. These are imitation pieces, so use words such as "gold-look", never "gold plated" unless it is true.',
)

export const StoneTypes = library(
  'stone-types',
  { plural: 'Stone types', singular: 'Stone type' },
  'What the stones are made of: AD / CZ, kundan-look glass, pearl-look beads, crystals…',
)
