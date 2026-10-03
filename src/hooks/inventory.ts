import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

import { relationshipID } from '../lib/catalog'

type AdjustmentContext = {
  note?: string
  operationId?: string
  reason?: 'damage' | 'initial_stock' | 'manual_adjustment'
}

export const validateInventoryBalance: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const onHand = data.onHand ?? originalDoc?.onHand ?? 0
  const reserved = data.reserved ?? originalDoc?.reserved ?? 0

  if (reserved > onHand) throw new Error('Reserved stock cannot exceed on-hand stock.')
  return data
}

export const recordInventoryMovement: CollectionAfterChangeHook = async ({
  context,
  doc,
  operation,
  previousDoc,
  req,
}) => {
  const before = operation === 'create' ? 0 : Number(previousDoc?.onHand ?? 0)
  const after = Number(doc.onHand ?? 0)
  const quantityDelta = after - before
  if (quantityDelta === 0) return doc

  const adjustment = (context.inventoryAdjustment ?? {}) as AdjustmentContext
  const actorID = req.user?.collection === 'admins' ? relationshipID(req.user) : undefined

  await req.payload.create({
    collection: 'inventory-movements',
    overrideAccess: true,
    req,
    data: {
      variant: relationshipID(doc.variant) as number,
      quantityDelta,
      reason: adjustment.reason ?? (operation === 'create' ? 'initial_stock' : 'manual_adjustment'),
      referenceId: adjustment.operationId,
      referenceType: 'staff_adjustment',
      performedBy: actorID as number | undefined,
      note: adjustment.note,
      occurredAt: new Date().toISOString(),
    },
  })

  return doc
}
