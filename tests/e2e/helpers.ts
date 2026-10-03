import type { Harness } from './harness'
import { emailFor, password } from './harness'
import { MobileApp } from './mobile'

/** A registered, signed-in customer with a default address, ready to shop. */
export const newCustomer = async (name: string, withAddress = true) => {
  const app = new MobileApp(emailFor(name), password)
  await app.register(name)
  const address = withAddress ? await app.addAddress() : undefined
  return { address, app }
}

export type Stock = { available: number; onHand: number; reserved: number }

/** Current inventory counters for a variant, read straight from the database. */
export const stockOf = async (h: Harness, variantId: number): Promise<Stock> => {
  const result = await h.payload.find({
    collection: 'inventory',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { variant: { equals: variantId } },
  })
  const record = result.docs[0]
  return {
    available: record.onHand - record.reserved,
    onHand: record.onHand,
    reserved: record.reserved,
  }
}

export const movementsOf = async (h: Harness, variantId: number) =>
  (
    await h.payload.find({
      collection: 'inventory-movements',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      pagination: false,
      sort: 'createdAt',
      where: { variant: { equals: variantId } },
    })
  ).docs

export const reservationsOf = async (h: Harness, orderId: number | string) =>
  (
    await h.payload.find({
      collection: 'inventory-reservations',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      pagination: false,
      where: { order: { equals: Number(orderId) } },
    })
  ).docs

export const attemptsOf = async (h: Harness, orderId: number | string) =>
  (
    await h.payload.find({
      collection: 'payment-attempts',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      pagination: false,
      sort: 'createdAt',
      where: { order: { equals: Number(orderId) } },
    })
  ).docs

export const rawOrder = async (h: Harness, orderId: number | string) =>
  h.payload.findByID({ collection: 'orders', depth: 0, id: Number(orderId), overrideAccess: true })

let keyCounter = 0
export const idemKey = (label = 'k') =>
  `e2e-${label}-${Date.now().toString(36)}-${++keyCounter}-${Math.random().toString(36).slice(2, 8)}`

/** Admin session for REST calls that need staff permissions. */
export const adminToken = async (h: Harness): Promise<string> => {
  const response = await h.rest('POST', '/admins/login', {
    body: { email: h.admin.email, password },
  })
  const body = (await response.json()) as { token?: string }
  if (!body.token) throw new Error('Admin login failed in the e2e harness.')
  return body.token
}
