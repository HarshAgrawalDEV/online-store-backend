import type { GlobalConfig } from 'payload'

import { canManageCatalog, readForActiveStaff } from '../access/catalog'
import { validateOptionalNonNegativeInteger } from '../lib/catalog'

export const ShippingSettings: GlobalConfig = {
  slug: 'shipping-settings',
  label: 'Shipping Settings',
  admin: { group: 'Settings' },
  access: { read: readForActiveStaff, update: canManageCatalog },
  fields: [
    {
      name: 'freeShippingAbovePaise',
      type: 'number',
      defaultValue: 0,
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'standardFeePaise',
      type: 'number',
      defaultValue: 0,
      validate: validateOptionalNonNegativeInteger,
    },
    { name: 'codEnabled', type: 'checkbox', required: true, defaultValue: true },
    {
      name: 'codFeePaise',
      type: 'number',
      defaultValue: 0,
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'handlingDays',
      type: 'number',
      defaultValue: 1,
      validate: validateOptionalNonNegativeInteger,
    },
    {
      name: 'localServiceabilityMode',
      type: 'select',
      required: true,
      defaultValue: 'development_all_india',
      options: [
        { label: 'Disabled', value: 'disabled' },
        { label: 'Development: all Indian pincodes', value: 'development_all_india' },
      ],
      admin: {
        description:
          'Development fallback only. Replace with a carrier serviceability check before production.',
      },
    },
  ],
}
