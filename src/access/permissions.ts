import type { Access, FieldAccess } from 'payload'

import type { AdminRole } from './admins'

/**
 * Single source of truth for what each staff role may do.
 *
 * Collections and endpoints must ask for a permission here instead of testing
 * "is active staff" or comparing role names, so a role change is one edit and
 * one test (tests/permissions.spec.ts).
 */
export const permissions = [
  'catalog.manage', // products, variants, categories, media, coupons, shipping settings
  'catalog.cost.read', // supplier cost prices
  'inventory.manage', // stock levels and adjustments
  'customers.read', // customer profiles and their saved data (addresses, carts, wishlists)
  'customers.update', // edit non-security customer profile fields and addresses
  'customers.security', // email, password, status, phone verification
  'customers.delete',
  'commerce.read', // orders, payments, reservations, redemptions
  'orders.manage', // move orders through fulfilment, expire reservations
] as const

export type Permission = (typeof permissions)[number]

export const rolePermissions: Record<AdminRole, readonly Permission[]> = {
  super_admin: permissions,
  catalog_manager: ['catalog.manage', 'catalog.cost.read', 'inventory.manage'],
  order_manager: ['inventory.manage', 'customers.read', 'commerce.read', 'orders.manage'],
  support: ['customers.read', 'customers.update', 'commerce.read'],
}

type StaffUser = {
  collection: 'admins'
  role?: AdminRole | null
  status?: 'active' | 'disabled' | null
}

const asActiveStaff = (user: unknown): StaffUser | undefined => {
  if (!user || typeof user !== 'object') return undefined
  const candidate = user as Partial<StaffUser>
  return candidate.collection === 'admins' && candidate.status === 'active'
    ? (candidate as StaffUser)
    : undefined
}

export const hasPermission = (user: unknown, permission: Permission): boolean => {
  const staff = asActiveStaff(user)
  if (!staff?.role) return false
  return rolePermissions[staff.role]?.includes(permission) ?? false
}

/** Collection-level access: allowed when the signed-in staff member holds the permission. */
export const can =
  (permission: Permission): Access =>
  ({ req: { user } }) =>
    hasPermission(user, permission)

/** Field-level access with the same rule. */
export const canField =
  (permission: Permission): FieldAccess =>
  ({ req: { user } }) =>
    hasPermission(user, permission)
