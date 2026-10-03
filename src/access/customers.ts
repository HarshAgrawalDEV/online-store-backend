import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

import { can, canField, hasPermission } from './permissions'

export type CustomerIdentity = {
  collection: 'customers'
  id: number | string
  status?: 'active' | 'suspended' | null
}

export const isCustomer = (user: unknown): user is CustomerIdentity => {
  if (!user || typeof user !== 'object') return false
  const candidate = user as Partial<CustomerIdentity>
  return candidate.collection === 'customers' && candidate.id !== undefined
}

export const isActiveCustomer = (user: unknown): user is CustomerIdentity =>
  isCustomer(user) && user.status === 'active'

export const staffOrSelf: Access = ({ req: { user } }) => {
  if (hasPermission(user, 'customers.read')) return true
  if (isActiveCustomer(user)) return { id: { equals: user.id } }
  return false
}

export const canUpdateCustomers: Access = can('customers.update')
export const canDeleteCustomers: Access = can('customers.delete')

export const ownerRead =
  (relationshipPath: string): Access =>
  ({ req: { user } }) => {
    if (hasPermission(user, 'customers.read')) return true
    if (!isActiveCustomer(user)) return false
    return { [relationshipPath]: { equals: user.id } } as Where
  }

/** Email, password, status and phone verification: super administrators only. */
export const customerSecurityField: FieldAccess = canField('customers.security')

export const requireCustomer = (req: PayloadRequest): CustomerIdentity => {
  if (!isActiveCustomer(req.user)) throw new CustomerAuthorizationError()
  return req.user
}

export class CustomerAuthorizationError extends Error {
  status = 401

  constructor(message = 'Customer authentication required.') {
    super(message)
  }
}
