import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relationshipID } from '../lib/catalog'
import { transactionDatabase, withTransaction } from './database/transaction'

export type InventoryAdjustment = {
  note?: string
  /** Client supplied id that makes a retried request apply only once. */
  operationId?: string
  quantityDelta: number
  reason: 'damage' | 'initial_stock' | 'manual_adjustment'
  variantID: number
}

export class InventoryAdjustmentError extends Error {}

/** The operation id was already used for a different adjustment. */
export class InventoryAdjustmentConflictError extends Error {}

export const parseInventoryAdjustment = (value: unknown): InventoryAdjustment => {
  if (!value || typeof value !== 'object')
    throw new InventoryAdjustmentError('A JSON body is required.')
  const body = value as Record<string, unknown>
  const variantID = Number(body.variantId)
  const quantityDelta = Number(body.quantityDelta)
  const reason = String(body.reason ?? 'manual_adjustment')

  if (!Number.isSafeInteger(variantID) || variantID <= 0) {
    throw new InventoryAdjustmentError('variantId must be a positive integer.')
  }
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new InventoryAdjustmentError('quantityDelta must be a non-zero integer.')
  }
  if (!['damage', 'initial_stock', 'manual_adjustment'].includes(reason)) {
    throw new InventoryAdjustmentError(
      'reason must be initial_stock, manual_adjustment, or damage.',
    )
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) {
    throw new InventoryAdjustmentError('note must be a string of at most 500 characters.')
  }

  if (
    body.operationId !== undefined &&
    !/^[A-Za-z0-9._:-]{8,120}$/.test(String(body.operationId))
  ) {
    throw new InventoryAdjustmentError('operationId must be 8-120 safe characters.')
  }

  return {
    note: body.note as string | undefined,
    operationId: body.operationId === undefined ? undefined : String(body.operationId),
    quantityDelta,
    reason: reason as InventoryAdjustment['reason'],
    variantID,
  }
}

const snapshot = (record: {
  id: number
  onHand: number
  reserved: number
  stockStatus?: null | string
  variant: unknown
}) => ({
  id: record.id,
  variant: relationshipID(record.variant as never),
  onHand: record.onHand,
  reserved: record.reserved,
  available: Math.max(0, Number(record.onHand) - Number(record.reserved)),
  stockStatus: record.stockStatus,
})

/**
 * Applies a stock change under a lock on the variant row, so concurrent adjustments are applied
 * one after another (no lost updates) and the movement history always adds up to on-hand stock.
 */
export const adjustInventory = async (req: PayloadRequest, adjustment: InventoryAdjustment) => {
  const variant = await req.payload.findByID({
    collection: 'product-variants',
    id: adjustment.variantID,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (!variant) throw new InventoryAdjustmentError('Variant not found.')

  return withTransaction(req, async () => {
    const db = await transactionDatabase(req)
    await db.execute(
      sql`SELECT id FROM product_variants WHERE id = ${adjustment.variantID} FOR UPDATE`,
    )

    // Reservations update this row with plain SQL, so lock it too: a checkout cannot change
    // reserved stock between the balance check below and the write.
    await db.execute(
      sql`SELECT id FROM inventory WHERE variant_id = ${adjustment.variantID} FOR UPDATE`,
    )

    const existing = await req.payload.find({
      collection: 'inventory',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { variant: { equals: adjustment.variantID } },
    })
    const record = existing.docs[0]

    if (adjustment.operationId) {
      const previous = await req.payload.find({
        collection: 'inventory-movements',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        where: {
          and: [
            { referenceType: { equals: 'staff_adjustment' } },
            { referenceId: { equals: adjustment.operationId } },
          ],
        },
      })
      const done = previous.docs[0]
      if (done) {
        if (
          relationshipID(done.variant) !== adjustment.variantID ||
          Number(done.quantityDelta) !== adjustment.quantityDelta
        ) {
          throw new InventoryAdjustmentConflictError(
            'This operationId was already used for a different adjustment.',
          )
        }
        if (!record) throw new InventoryAdjustmentError('Inventory record not found.')
        return snapshot(record)
      }
    }

    const currentOnHand = Number(record?.onHand ?? 0)
    const reserved = Number(record?.reserved ?? 0)
    const nextOnHand = currentOnHand + adjustment.quantityDelta

    if (nextOnHand < 0)
      throw new InventoryAdjustmentError('Adjustment would make on-hand stock negative.')
    if (nextOnHand < reserved)
      throw new InventoryAdjustmentError(
        'Adjustment would make on-hand stock lower than reserved stock.',
      )

    const context = {
      inventoryAdjustment: {
        note: adjustment.note,
        operationId: adjustment.operationId,
        reason: adjustment.reason,
      },
    }
    const stockStatus =
      nextOnHand === reserved
        ? 'out_of_stock'
        : record?.stockStatus === 'paused'
          ? 'paused'
          : 'available'

    const updated = record
      ? await req.payload.update({
          collection: 'inventory',
          id: record.id,
          context,
          data: { onHand: nextOnHand, stockStatus },
          depth: 0,
          overrideAccess: true,
          req,
        })
      : await req.payload.create({
          collection: 'inventory',
          context,
          data: {
            variant: relationshipID(variant) as number,
            onHand: nextOnHand,
            reserved: 0,
            reorderPoint: 0,
            stockStatus,
          },
          depth: 0,
          overrideAccess: true,
          req,
        })

    return snapshot(updated)
  })
}
