import { APIError, type CollectionConfig } from 'payload'

import { hasPermission } from '../access/permissions'
import {
  canDeleteCustomers,
  canUpdateCustomers,
  customerSecurityField,
  staffOrSelf,
} from '../access/customers'
import { customerCollectionEndpoints } from '../endpoints/customer-auth'
import { normalizeIndianPhone, validateIndianPhone } from '../lib/customer-validation'
import { limitAuthOperations, withRateLimit } from '../lib/rate-limit'

export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    group: 'Customers',
    defaultColumns: ['firstName', 'lastName', 'email', 'phoneNumber', 'status'],
    useAsTitle: 'email',
  },
  auth: {
    lockTime: 15 * 60 * 1000,
    maxLoginAttempts: 5,
    tokenExpiration: 7 * 24 * 60 * 60,
    useSessions: true,
    forgotPassword: {
      expiration: 60 * 60 * 1000,
      minRequestInterval: 60 * 1000,
    },
  },
  endpoints: customerCollectionEndpoints.map(withRateLimit),
  access: {
    admin: ({ req: { user } }) => hasPermission(user, 'customers.read'),
    create: () => false,
    delete: canDeleteCustomers,
    read: staffOrSelf,
    update: canUpdateCustomers,
  },
  hooks: {
    beforeOperation: [limitAuthOperations],
    // Email and password are auth fields, so field-level access cannot guard them reliably.
    // Only roles with customers.security may change them through the Admin or REST API.
    beforeValidate: [
      ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update' || !req.user || req.user.collection !== 'admins') return data
        if (hasPermission(req.user, 'customers.security')) return data
        const changesEmail =
          typeof data?.email === 'string' &&
          data.email !== (originalDoc as { email?: string })?.email
        if (data?.password || changesEmail) {
          throw new APIError(
            'Changing a customer email or password requires super administrator access.',
            403,
          )
        }
        return data
      },
    ],
    beforeLogin: [
      ({ user }) => {
        if (user.status !== 'active') throw new APIError('Invalid email or password.', 401)
        return user
      },
    ],
    afterLogin: [
      async ({ req, user }) => {
        await req.payload.update({
          collection: 'customers',
          id: user.id,
          data: { lastLoginAt: new Date().toISOString() },
          depth: 0,
          overrideAccess: true,
          req,
        })
        return user
      },
    ],
  },
  fields: [
    { name: 'firstName', type: 'text', required: true, minLength: 2, maxLength: 80 },
    { name: 'lastName', type: 'text', maxLength: 80 },
    {
      name: 'phoneNumber',
      type: 'text',
      unique: true,
      index: true,
      validate: validateIndianPhone,
      hooks: {
        beforeValidate: [
          ({ value }) =>
            typeof value === 'string' && value.trim() ? normalizeIndianPhone(value) : null,
        ],
      },
    },
    {
      name: 'phoneVerified',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      access: { create: customerSecurityField, update: customerSecurityField },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: ['active', 'suspended'],
      index: true,
      access: { create: customerSecurityField, update: customerSecurityField },
    },
    {
      name: 'lastLoginAt',
      type: 'date',
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
  ],
  timestamps: true,
}
