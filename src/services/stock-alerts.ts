import type { PayloadRequest } from 'payload'

import type { Inventory, Product, ProductVariant } from '../payload-types'

import { requireCustomer } from '../access/customers'
import { MobileAPIError } from '../lib/api-response'
import { relationshipID } from '../lib/catalog'
import { parseRouteID } from './addresses'

const MAX_ALERTS = 100

const availableQuantity = (inventory?: Inventory): number =>
  inventory?.stockStatus === 'available'
    ? Math.max(0, Number(inventory.onHand) - Number(inventory.reserved))
    : 0

const loadInventory = async (req: PayloadRequest, variantIDs: number[]) => {
  if (variantIDs.length === 0) return new Map<number, Inventory>()
  const result = await req.payload.find({
    collection: 'inventory',
    depth: 0,
    limit: variantIDs.length,
    overrideAccess: true,
    pagination: false,
    req,
    where: { variant: { in: variantIDs } },
  })
  return new Map(
    result.docs.map((row) => [relationshipID(row.variant) as number, row] as [number, Inventory]),
  )
}

/** Ask to be told when a sold-out option is back. Asking twice is fine. */
export const createStockAlert = async (req: PayloadRequest, value: unknown) => {
  const customer = requireCustomer(req)
  const variantID = Number((value as Record<string, unknown> | undefined)?.variantId)
  if (!Number.isSafeInteger(variantID) || variantID <= 0) {
    throw new MobileAPIError('VALIDATION_ERROR', 'variantId must be a positive integer.')
  }

  const variant = (await req.payload
    .findByID({
      collection: 'product-variants',
      depth: 0,
      id: variantID,
      overrideAccess: true,
      req,
    })
    .catch(() => null)) as ProductVariant | null
  const product = variant
    ? ((await req.payload
        .findByID({
          collection: 'products',
          depth: 0,
          id: relationshipID(variant.product) as number,
          overrideAccess: true,
          req,
        })
        .catch(() => null)) as Product | null)
    : null
  if (!variant || variant.status !== 'active' || product?.status !== 'active') {
    throw new MobileAPIError('NOT_FOUND', 'Active option not found.', 404)
  }

  const inventory = (await loadInventory(req, [variantID])).get(variantID)
  if (availableQuantity(inventory) > 0) {
    throw new MobileAPIError('ALREADY_AVAILABLE', 'This option is in stock right now.', 409)
  }

  const find = () =>
    req.payload.find({
      collection: 'stock-alerts',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { and: [{ customer: { equals: customer.id } }, { variant: { equals: variantID } }] },
    })
  const existing = await find()
  if (existing.docs[0])
    return { alertId: existing.docs[0].id, alreadyWaiting: true, variantId: variantID }

  const count = await req.payload.count({
    collection: 'stock-alerts',
    overrideAccess: true,
    req,
    where: { customer: { equals: customer.id } },
  })
  if (count.totalDocs >= MAX_ALERTS) {
    throw new MobileAPIError(
      'LIMIT_REACHED',
      `You can wait for up to ${MAX_ALERTS} options at once.`,
      409,
    )
  }

  try {
    const created = await req.payload.create({
      collection: 'stock-alerts',
      data: { customer: customer.id as number, variant: variantID },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return { alertId: created.id, alreadyWaiting: false, variantId: variantID }
  } catch (error) {
    // A double tap created the same alert first.
    const winner = await find()
    if (winner.docs[0])
      return { alertId: winner.docs[0].id, alreadyWaiting: true, variantId: variantID }
    throw error
  }
}

/** The customer's own alerts, each with whether the option can be bought now. */
export const listStockAlerts = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  const alerts = await req.payload.find({
    collection: 'stock-alerts',
    depth: 0,
    limit: MAX_ALERTS,
    overrideAccess: true,
    pagination: false,
    req,
    sort: '-createdAt',
    where: { customer: { equals: customer.id } },
  })
  const variantIDs = alerts.docs.map((alert) => relationshipID(alert.variant) as number)
  if (variantIDs.length === 0) return { docs: [] }

  const [variants, inventory] = await Promise.all([
    req.payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: variantIDs.length,
      overrideAccess: true,
      pagination: false,
      req,
      where: { id: { in: variantIDs } },
    }),
    loadInventory(req, variantIDs),
  ])
  const variantsByID = new Map(variants.docs.map((variant) => [variant.id, variant]))
  const productIDs = [
    ...new Set(variants.docs.map((variant) => relationshipID(variant.product) as number)),
  ]
  const products = await req.payload.find({
    collection: 'products',
    depth: 0,
    limit: productIDs.length || 1,
    overrideAccess: true,
    pagination: false,
    req,
    where: { id: { in: productIDs } },
  })
  const productsByID = new Map(products.docs.map((product) => [product.id, product]))

  const docs = alerts.docs.flatMap((alert) => {
    const variantID = relationshipID(alert.variant) as number
    const variant = variantsByID.get(variantID)
    const product = variant
      ? productsByID.get(relationshipID(variant.product) as number)
      : undefined
    // Options that were switched off or archived no longer matter to the customer.
    if (!variant || variant.status !== 'active' || !product || product.status !== 'active')
      return []
    const quantity = availableQuantity(inventory.get(variantID))
    return [
      {
        alertId: alert.id,
        available: quantity > 0,
        colourLabel: variant.colourLabel ?? null,
        createdAt: alert.createdAt,
        productId: product.id,
        productName: product.name,
        sizeLabel: variant.sizeLabel ?? null,
        variantId: variantID,
      },
    ]
  })
  return { docs }
}

export const removeStockAlert = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  const variantID = parseRouteID(req, 'variantId')
  const found = await req.payload.find({
    collection: 'stock-alerts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ customer: { equals: customer.id } }, { variant: { equals: variantID } }] },
  })
  if (!found.docs[0])
    throw new MobileAPIError('NOT_FOUND', 'You are not waiting for this option.', 404)
  await req.payload.delete({
    collection: 'stock-alerts',
    id: found.docs[0].id,
    overrideAccess: true,
    req,
  })
  return { removed: true, variantId: variantID }
}
