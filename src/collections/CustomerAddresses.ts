import type { CollectionConfig } from 'payload'

import { denyAccess } from '../access/catalog'
import { canDeleteCustomers, canUpdateCustomers, ownerRead } from '../access/customers'
import {
  indianStateCodes,
  normalizeIndianPhone,
  validateIndianPhone,
  validateIndianPincode,
} from '../lib/customer-validation'

export const CustomerAddresses: CollectionConfig = {
  slug: 'customer-addresses',
  admin: {
    group: 'Customers',
    defaultColumns: ['recipientName', 'customer', 'city', 'stateCode', 'pincode', 'isDefault'],
    useAsTitle: 'recipientName',
  },
  access: {
    create: denyAccess,
    delete: canDeleteCustomers,
    read: ownerRead('customer'),
    update: canUpdateCustomers,
  },
  indexes: [{ fields: ['customer', 'isDefault'] }],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    { name: 'recipientName', type: 'text', required: true, maxLength: 120 },
    {
      name: 'phoneNumber',
      type: 'text',
      required: true,
      validate: validateIndianPhone,
      hooks: { beforeValidate: [({ value }) => normalizeIndianPhone(String(value || ''))] },
    },
    { name: 'line1', type: 'text', required: true, maxLength: 180 },
    { name: 'line2', type: 'text', maxLength: 180 },
    { name: 'landmark', type: 'text', maxLength: 140 },
    { name: 'city', type: 'text', required: true, maxLength: 100 },
    {
      name: 'stateCode',
      type: 'select',
      required: true,
      options: indianStateCodes.map((code) => ({ label: code, value: code })),
    },
    { name: 'pincode', type: 'text', required: true, index: true, validate: validateIndianPincode },
    { name: 'countryCode', type: 'select', required: true, defaultValue: 'IN', options: ['IN'] },
    {
      name: 'addressType',
      type: 'select',
      required: true,
      defaultValue: 'home',
      options: ['home', 'work', 'other'],
    },
    { name: 'isDefault', type: 'checkbox', required: true, defaultValue: false },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
