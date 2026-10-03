import type { Access } from 'payload'

import { can, hasPermission } from './permissions'

export const readCommerceForStaff: Access = can('commerce.read')

export const canManageOrders = (user: unknown): boolean => hasPermission(user, 'orders.manage')

export const commerceServiceOnly: Access = () => false
