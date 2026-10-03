import type { CollectionConfig } from 'payload'

import { canManageCatalog, readForActiveStaff } from '../access/catalog'
import { validateOptionalNonNegativeInteger } from '../lib/catalog'
import { normalizeCouponCode } from '../lib/customer-validation'

export const Coupons: CollectionConfig = {
  slug: 'coupons',
  admin: {
    group: 'Shopping',
    defaultColumns: ['code', 'promotion', 'status', 'usageLimit', 'perCustomerLimit', 'endsAt'],
    useAsTitle: 'code',
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
          throw new Error('Coupon start time must be earlier than its end time.')
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 40,
      hooks: { beforeValidate: [({ value }) => normalizeCouponCode(String(value || ''))] },
    },
    { name: 'description', type: 'textarea', maxLength: 500 },
    {
      name: 'promotion',
      type: 'relationship',
      relationTo: 'promotions',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'disabled'],
      index: true,
    },
    { name: 'usageLimit', type: 'number', validate: validateOptionalNonNegativeInteger },
    {
      name: 'perCustomerLimit',
      type: 'number',
      defaultValue: 1,
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'minimumCartPaise',
      type: 'number',
      defaultValue: 0,
      validate: validateOptionalNonNegativeInteger,
    },
    { name: 'startsAt', type: 'date', index: true },
    { name: 'endsAt', type: 'date', index: true },
  ],
  timestamps: true,
}
