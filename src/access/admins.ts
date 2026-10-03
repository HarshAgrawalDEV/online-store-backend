import type { Access, FieldAccess } from 'payload'

export const adminRoles = ['super_admin', 'catalog_manager', 'order_manager', 'support'] as const

export type AdminRole = (typeof adminRoles)[number]

type AdminIdentity = {
  collection: 'admins'
  id: number | string
  role?: AdminRole | null
  status?: 'active' | 'disabled' | null
}

const isAdminIdentity = (value: unknown): value is AdminIdentity => {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<AdminIdentity>
  return candidate.collection === 'admins' && candidate.id !== undefined
}

const isActiveAdmin = (value: unknown): value is AdminIdentity =>
  isAdminIdentity(value) && value.status === 'active'

export const isSuperAdmin = (value: unknown): boolean =>
  isActiveAdmin(value) && value.role === 'super_admin'

export const canAccessAdmin = ({ req: { user } }: Parameters<Access>[0]): boolean =>
  isActiveAdmin(user)

/**
 * Anonymous creation of the very first administrator is a convenience for local development
 * only. In production it is closed unless ALLOW_ADMIN_BOOTSTRAP=true is set deliberately, and the
 * first administrator is created with `pnpm create-admin` instead. This stops an empty admin
 * table (fresh deploy, or all admins deleted) from letting anyone claim super administrator.
 */
const anonymousBootstrapAllowed = async (req: Parameters<Access>[0]['req']): Promise<boolean> => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true')
    return false
  const existingAdmins = await req.payload.count({ collection: 'admins', overrideAccess: true })
  return existingAdmins.totalDocs === 0
}

export const canCreateAdmin: Access = async ({ req }) => {
  if (isSuperAdmin(req.user)) return true
  if (req.user) return false

  return anonymousBootstrapAllowed(req)
}

export const canReadAdmin: Access = ({ req: { user } }) => {
  if (!isActiveAdmin(user)) return false
  if (user.role === 'super_admin') return true

  return { id: { equals: user.id } }
}

export const canUpdateAdmin: Access = canReadAdmin

export const canDeleteAdmin: Access = ({ req: { user } }) => isSuperAdmin(user)

export const canManageAdminSecurityFields: FieldAccess = ({ req: { user } }) => isSuperAdmin(user)

export const canSetAdminSecurityFieldsOnCreate: FieldAccess = async ({ req }) => {
  if (isSuperAdmin(req.user)) return true
  if (req.user) return false

  return anonymousBootstrapAllowed(req)
}
