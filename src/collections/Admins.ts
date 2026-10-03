import type { CollectionConfig } from 'payload'

import {
  adminRoles,
  canAccessAdmin,
  canCreateAdmin,
  canDeleteAdmin,
  canManageAdminSecurityFields,
  canReadAdmin,
  canSetAdminSecurityFieldsOnCreate,
  canUpdateAdmin,
} from '../access/admins'
import { limitAuthOperations } from '../lib/rate-limit'

export const Admins: CollectionConfig = {
  slug: 'admins',
  admin: {
    defaultColumns: ['name', 'email', 'role', 'status'],
    useAsTitle: 'name',
  },
  auth: true,
  access: {
    admin: canAccessAdmin,
    create: canCreateAdmin,
    delete: canDeleteAdmin,
    read: canReadAdmin,
    update: canUpdateAdmin,
  },
  hooks: {
    beforeOperation: [limitAuthOperations],
    beforeValidate: [
      ({ data, operation, req }) => {
        if (operation === 'create' && !req.user) {
          return {
            ...data,
            role: 'super_admin',
            status: 'active',
          }
        }

        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 2,
      maxLength: 120,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'support',
      options: adminRoles.map((role) => ({
        label: role
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
        value: role,
      })),
      access: {
        create: canSetAdminSecurityFieldsOnCreate,
        update: canManageAdminSecurityFields,
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Disabled', value: 'disabled' },
      ],
      access: {
        create: canSetAdminSecurityFieldsOnCreate,
        update: canManageAdminSecurityFields,
      },
    },
    {
      name: 'lastLoginAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ],
  timestamps: true,
}
