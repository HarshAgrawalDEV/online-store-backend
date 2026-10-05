import type { CollectionConfig } from 'payload'

import { canManageCatalog, readActiveLibraryItems } from '../access/catalog'
import { normalizeCode, validateOptionalHexColor } from '../lib/catalog'
import { shortCodeFromName } from '../lib/set-details'

/**
 * One colour library for every product, whatever its material or type.
 * Staff can also type a one-off colour on a variant and save it here from the variant form.
 */
export const Colours: CollectionConfig = {
  slug: 'colours',
  admin: {
    group: 'Catalog',
    defaultColumns: ['name', 'swatchHex', 'shortCode', 'sortOrder', 'isActive'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readActiveLibraryItems,
    update: canManageCatalog,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 60 },
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 60,
      admin: { description: 'Generated from the name. Used in filters.' },
      hooks: {
        beforeValidate: [
          ({ siblingData, value }) => normalizeCode(String(value || siblingData.name || '')),
        ],
      },
    },
    {
      name: 'shortCode',
      type: 'text',
      maxLength: 8,
      admin: {
        description: 'Short code used in SKUs, for example RANI or MAROON. Generated when empty.',
      },
      hooks: {
        beforeValidate: [
          ({ siblingData, value }) =>
            (typeof value === 'string' && value.trim()
              ? value.trim()
              : shortCodeFromName(String(siblingData.name ?? ''))
            ).toUpperCase(),
        ],
      },
    },
    { name: 'swatchHex', type: 'text', validate: validateOptionalHexColor },
    { name: 'sortOrder', type: 'number', required: true, defaultValue: 0, min: 0 },
    {
      name: 'note',
      type: 'text',
      maxLength: 200,
      admin: {
        description: 'Optional customer note, for example "Shade may vary slightly" for chiku.',
      },
    },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
