import path from 'path'
import type { CollectionConfig } from 'payload'

import { canManageCatalog } from '../access/catalog'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Catalog',
    useAsTitle: 'alt',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: () => true,
    update: canManageCatalog,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      maxLength: 180,
    },
    {
      name: 'caption',
      type: 'textarea',
      maxLength: 500,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'product',
      options: ['product', 'lifestyle', 'editorial', 'review', 'other'],
    },
    {
      name: 'photographerCredit',
      type: 'text',
      maxLength: 160,
    },
  ],
  upload: {
    staticDir: path.resolve(process.cwd(), 'media'),
    adminThumbnail: 'thumbnail',
    pasteURL: false,
    mimeTypes: ['image/*'],
    imageSizes: [
      { name: 'thumbnail', width: 320, height: 320, fit: 'cover' },
      { name: 'card', width: 800, height: 800, fit: 'cover' },
      { name: 'hero', width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true },
    ],
  },
}
