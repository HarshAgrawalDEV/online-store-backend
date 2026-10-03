import type { AccessArgs } from 'payload'
import { describe, expect, it } from 'vitest'

import type { AdminRole } from '@/access/admins'
import { canManageCatalog, isInventoryStaff, readActiveVariants } from '@/access/catalog'
import { readCommerceForStaff } from '@/access/commerce'
import {
  canDeleteCustomers,
  canUpdateCustomers,
  customerSecurityField,
  ownerRead,
  staffOrSelf,
} from '@/access/customers'
import { hasPermission, permissions, rolePermissions } from '@/access/permissions'
import { Customers } from '@/collections/Customers'
import { Carts } from '@/collections/Carts'
import { CustomerAddresses } from '@/collections/CustomerAddresses'
import { WishlistItems } from '@/collections/WishlistItems'

const staff = (role: AdminRole, status: 'active' | 'disabled' = 'active') => ({
  collection: 'admins',
  id: 1,
  role,
  status,
})
const args = (user: unknown) => ({ req: { user } }) as unknown as AccessArgs<unknown>
const fieldArgs = (user: unknown) => ({ req: { user } }) as never

describe('role permission matrix', () => {
  it('gives super administrators everything', () => {
    for (const permission of permissions)
      expect(hasPermission(staff('super_admin'), permission)).toBe(true)
  })

  it('keeps catalog managers away from customers and orders', () => {
    const user = staff('catalog_manager')
    expect(hasPermission(user, 'catalog.manage')).toBe(true)
    expect(hasPermission(user, 'catalog.cost.read')).toBe(true)
    for (const permission of [
      'customers.read',
      'customers.update',
      'customers.security',
      'commerce.read',
    ] as const) {
      expect(hasPermission(user, permission)).toBe(false)
    }
  })

  it('lets support help customers without touching security, catalog or stock', () => {
    const user = staff('support')
    expect(hasPermission(user, 'customers.read')).toBe(true)
    expect(hasPermission(user, 'customers.update')).toBe(true)
    expect(hasPermission(user, 'commerce.read')).toBe(true)
    for (const permission of [
      'customers.security',
      'customers.delete',
      'catalog.manage',
      'catalog.cost.read',
      'inventory.manage',
      'orders.manage',
    ] as const) {
      expect(hasPermission(user, permission)).toBe(false)
    }
  })

  it('lets order managers fulfil orders and move stock but not edit customers', () => {
    const user = staff('order_manager')
    expect(hasPermission(user, 'orders.manage')).toBe(true)
    expect(hasPermission(user, 'inventory.manage')).toBe(true)
    expect(hasPermission(user, 'customers.read')).toBe(true)
    expect(hasPermission(user, 'customers.update')).toBe(false)
    expect(hasPermission(user, 'catalog.manage')).toBe(false)
  })

  it('denies disabled staff, customers and anonymous callers everything', () => {
    for (const user of [
      staff('super_admin', 'disabled'),
      { collection: 'customers', id: 1 },
      null,
      undefined,
    ]) {
      for (const permission of permissions) expect(hasPermission(user, permission)).toBe(false)
    }
  })

  it('defines a permission set for every role', () => {
    expect(Object.keys(rolePermissions).sort()).toEqual([
      'catalog_manager',
      'order_manager',
      'super_admin',
      'support',
    ])
  })
})

describe('collection access follows the matrix', () => {
  it('limits customer security fields and deletion to super administrators', () => {
    expect(customerSecurityField(fieldArgs(staff('support')))).toBe(false)
    expect(customerSecurityField(fieldArgs(staff('super_admin')))).toBe(true)
    expect(canDeleteCustomers(args(staff('support')))).toBe(false)
    expect(canDeleteCustomers(args(staff('super_admin')))).toBe(true)
    expect(canUpdateCustomers(args(staff('support')))).toBe(true)
    expect(canUpdateCustomers(args(staff('catalog_manager')))).toBe(false)
  })

  it('shows customer records only to roles that need them, and customers to themselves', () => {
    expect(staffOrSelf(args(staff('catalog_manager')))).toBe(false)
    expect(staffOrSelf(args(staff('support')))).toBe(true)
    expect(staffOrSelf(args({ collection: 'customers', id: 9, status: 'active' }))).toEqual({
      id: { equals: 9 },
    })
    expect(ownerRead('customer')(args(staff('catalog_manager')))).toBe(false)
    expect(ownerRead('customer')(args(staff('order_manager')))).toBe(true)
  })

  it('keeps order data away from catalog managers', () => {
    expect(readCommerceForStaff(args(staff('catalog_manager')))).toBe(false)
    expect(readCommerceForStaff(args(staff('support')))).toBe(true)
  })

  it('keeps catalog and inventory roles distinct', () => {
    expect(canManageCatalog(args(staff('order_manager')))).toBe(false)
    expect(isInventoryStaff(staff('order_manager'))).toBe(true)
    expect(isInventoryStaff(staff('support'))).toBe(false)
  })

  it('stops staff from writing carts, wishlists and new addresses directly', async () => {
    const superAdmin = args(staff('super_admin'))
    for (const collection of [Carts, WishlistItems, CustomerAddresses]) {
      expect(await collection.access?.create?.(superAdmin)).toBe(false)
    }
    expect(await Carts.access?.update?.(superAdmin)).toBe(false)
    expect(await Carts.access?.delete?.(superAdmin)).toBe(false)
  })

  it('hides variants of unpublished products from the public', () => {
    expect(readActiveVariants(args(staff('catalog_manager')))).toBe(true)
    expect(readActiveVariants(args(null))).toEqual({
      and: [{ status: { equals: 'active' } }, { 'product.status': { equals: 'active' } }],
    })
  })
})

describe('customer email and password changes', () => {
  const hook = Customers.hooks?.beforeValidate?.[0] as (input: unknown) => unknown
  const run = (user: unknown, data: Record<string, unknown>) =>
    hook({ data, operation: 'update', originalDoc: { email: 'a@example.com' }, req: { user } })

  it('are refused for support staff', () => {
    expect(() => run(staff('support'), { password: 'NewPassw0rdX' })).toThrow(/super administrator/)
    expect(() => run(staff('support'), { email: 'b@example.com' })).toThrow(/super administrator/)
  })

  it('allow ordinary profile edits by support and any change by super administrators', () => {
    expect(run(staff('support'), { firstName: 'Asha', email: 'a@example.com' })).toMatchObject({
      firstName: 'Asha',
    })
    expect(run(staff('super_admin'), { password: 'NewPassw0rdX' })).toMatchObject({
      password: 'NewPassw0rdX',
    })
  })

  it('do not interfere with customers changing their own password', () => {
    expect(run({ collection: 'customers', id: 1 }, { password: 'NewPassw0rdX' })).toMatchObject({
      password: 'NewPassw0rdX',
    })
  })
})
