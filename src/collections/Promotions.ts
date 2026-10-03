import type { CollectionConfig } from 'payload'

import { canManageCatalog, readForActiveStaff } from '../access/catalog'
import {
  validateOptionalNonNegativeInteger,
  validateRequiredNonNegativeInteger,
} from '../lib/catalog'

export const Promotions: CollectionConfig = {
  slug: 'promotions',
  admin: {
    group: 'Shopping',
    defaultColumns: ['name', 'discountType', 'discountValue', 'status', 'startsAt', 'endsAt'],
    useAsTitle: 'name',
  },
  access: {
    create: canManageCatalog,
    delete: canManageCatalog,
    read: readForActiveStaff,
    update: canManageCatalog,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data?.startsAt && data.endsAt && new Date(data.startsAt) >= new Date(data.endsAt)) {
          throw new Error('Promotion start time must be earlier than its end time.')
        }
        if (data?.discountType === 'percentage' && Number(data.discountValue) > 100) {
          throw new Error('Percentage discount cannot exceed 100.')
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 140 },
    { name: 'description', type: 'textarea', maxLength: 500 },
    {
      name: 'discountType',
      type: 'select',
      required: true,
      options: ['percentage', 'fixed'],
    },
    {
      name: 'discountValue',
      type: 'number',
      required: true,
      validate: validateRequiredNonNegativeInteger,
    },
    {
      name: 'maxDiscountPaise',
      type: 'number',
      validate: validateOptionalNonNegativeInteger,
    },
    { name: 'startsAt', type: 'date', index: true },
    { name: 'endsAt', type: 'date', index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: ['draft', 'active', 'paused', 'expired'],
      index: true,
    },
    {
      name: 'applicableProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
    },
    {
      name: 'applicableCategories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
    },
  ],
  timestamps: true,
}
