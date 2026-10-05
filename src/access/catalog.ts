import type { Access, FieldAccess, Where } from 'payload'

import type { AdminRole } from './admins'
import { can, canField, hasPermission } from './permissions'

type StaffIdentity = {
  collection: 'admins'
  id: number | string
  role?: AdminRole | null
  status?: 'active' | 'disabled' | null
}

export const isActiveStaff = (user: unknown): user is StaffIdentity => {
  if (!user || typeof user !== 'object') return false
  const candidate = user as Partial<StaffIdentity>

  return candidate.collection === 'admins' && candidate.status === 'active'
}

export const canManageCatalog: Access = can('catalog.manage')

export const isInventoryStaff = (user: unknown): user is StaffIdentity =>
  hasPermission(user, 'inventory.manage')

export const canManageInventory: Access = can('inventory.manage')

/** Supplier cost prices: catalog owners only. */
export const canReadCostField: FieldAccess = canField('catalog.cost.read')

export const readActiveCategories: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  return { isActive: { equals: true } }
}

export const readPublishedCollections: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  return { isPublished: { equals: true } }
}

export const readActiveProducts: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  return { status: { equals: 'active' } }
}

/** Public variants must be active and belong to an active (published) product. */
export const readActiveVariants: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  const where: Where = {
    and: [{ status: { equals: 'active' } }, { 'product.status': { equals: 'active' } }],
  }
  return where
}

/** Library lists (materials, sizes, colours, occasions): the public sees only active entries. */
export const readActiveLibraryItems: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  return { isActive: { equals: true } }
}

export const readActiveAttributeOptions: Access = ({ req: { user } }) => {
  if (isActiveStaff(user)) return true
  return { isActive: { equals: true } }
}

export const readForActiveStaff: Access = ({ req: { user } }) => isActiveStaff(user)

export const denyAccess: Access = () => false
