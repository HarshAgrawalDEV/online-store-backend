import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../payload.config'
import { adminRoles, type AdminRole } from '../access/admins'
import { validatePassword } from '../lib/customer-validation'

/**
 * Creates an administrator without exposing any public signup.
 *
 *   ADMIN_EMAIL=owner@example.com ADMIN_NAME="Owner" ADMIN_PASSWORD='...' pnpm create-admin
 *
 * ADMIN_ROLE defaults to super_admin. Existing administrators are never modified.
 */
const run = async () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator'
  const password = process.env.ADMIN_PASSWORD
  const role = (process.env.ADMIN_ROLE ?? 'super_admin') as AdminRole
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD.')
  if (!adminRoles.includes(role))
    throw new Error(`ADMIN_ROLE must be one of: ${adminRoles.join(', ')}`)
  const passwordProblem = validatePassword(password)
  if (passwordProblem !== true) throw new Error(passwordProblem)

  const payload = await getPayload({ config })
  const existing = await payload.find({
    collection: 'admins',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: email } },
  })
  if (existing.docs[0]) throw new Error(`An administrator with ${email} already exists.`)
  await payload.create({
    collection: 'admins',
    data: { email, name, password, role, status: 'active' },
    overrideAccess: true,
  })
  payload.logger.info(`Created ${role} ${email}`)
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
