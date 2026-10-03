import type { AccessArgs } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canAccessAdmin,
  canCreateAdmin,
  canReadAdmin,
  canSetAdminSecurityFieldsOnCreate,
} from '@/access/admins'

const accessArgs = (user: unknown, totalDocs = 0): AccessArgs<unknown> =>
  ({
    req: {
      payload: {
        count: vi.fn().mockResolvedValue({ totalDocs }),
      },
      user,
    },
  }) as unknown as AccessArgs<unknown>

const fieldAccessArgs = (user: unknown, totalDocs = 0) => accessArgs(user, totalDocs) as never

const activeAdmin = {
  collection: 'admins',
  id: 42,
  role: 'support',
  status: 'active',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('admin access', () => {
  it('permits active administrators into the Admin dashboard', () => {
    expect(canAccessAdmin(accessArgs(activeAdmin))).toBe(true)
    expect(canAccessAdmin(accessArgs({ ...activeAdmin, status: 'disabled' }))).toBe(false)
  })

  it('limits non-super administrators to their own document', () => {
    expect(canReadAdmin(accessArgs(activeAdmin))).toEqual({ id: { equals: 42 } })
  })

  it('allows active super administrators to read all administrator documents', () => {
    expect(canReadAdmin(accessArgs({ ...activeAdmin, role: 'super_admin' }))).toBe(true)
  })

  it('allows anonymous creation only while bootstrapping the first administrator', async () => {
    await expect(canCreateAdmin(accessArgs(null, 0))).resolves.toBe(true)
    await expect(canCreateAdmin(accessArgs(null, 1))).resolves.toBe(false)
  })

  it('closes anonymous first-admin creation in production unless explicitly allowed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_ADMIN_BOOTSTRAP', '')
    await expect(canCreateAdmin(accessArgs(null, 0))).resolves.toBe(false)
    await expect(canSetAdminSecurityFieldsOnCreate(fieldAccessArgs(null, 0))).resolves.toBe(false)
    vi.stubEnv('ALLOW_ADMIN_BOOTSTRAP', 'true')
    await expect(canCreateAdmin(accessArgs(null, 0))).resolves.toBe(true)
    await expect(canCreateAdmin(accessArgs(null, 1))).resolves.toBe(false)
  })

  it('never lets a signed-in non-super administrator create administrators', async () => {
    await expect(canCreateAdmin(accessArgs(activeAdmin, 0))).resolves.toBe(false)
    await expect(
      canCreateAdmin(accessArgs({ ...activeAdmin, role: 'super_admin' }, 5)),
    ).resolves.toBe(true)
  })
})
