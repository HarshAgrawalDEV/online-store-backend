import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { MobileAPIError } from '../../lib/api-response'
import { relationshipID } from '../../lib/catalog'
import { transactionDatabase, withTransaction } from '../database/transaction'

type ReservationLine = { quantity: number; variantId: number }
type Row = Record<string, unknown>

const rowsOf = (result: { rows?: unknown[] }): Row[] => (result.rows ?? []) as Row[]

export const reserveInventory = async (
  req: PayloadRequest,
  orderID: number,
  lines: ReservationLine[],
  expiresAt: string,
) => {
  const db = await transactionDatabase(req)
  const ordered = [...lines].sort((a, b) => a.variantId - b.variantId)
  for (const line of ordered) {
    const result = await db.execute(sql`
      UPDATE inventory
      SET reserved = reserved + ${line.quantity}, updated_at = now()
      WHERE variant_id = ${line.variantId}
        AND stock_status = 'available'
        AND on_hand - reserved >= ${line.quantity}
      RETURNING id
    `)
    if (!rowsOf(result).length) {
      throw new MobileAPIError('INSUFFICIENT_STOCK', 'Stock changed while placing the order.', 409)
    }
    await req.payload.create({
      collection: 'inventory-reservations',
      data: {
        expiresAt,
        order: orderID,
        quantity: line.quantity,
        status: 'active',
        variant: line.variantId,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
}

export const commitOrderReservations = async (req: PayloadRequest, orderID: number) => {
  const db = await transactionDatabase(req)
  const reservations = await req.payload.find({
    collection: 'inventory-reservations',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: { and: [{ order: { equals: orderID } }, { status: { equals: 'active' } }] },
  })
  if (!reservations.docs.length) return { committed: 0 }
  for (const reservation of reservations.docs) {
    const variantID = Number(relationshipID(reservation.variant))
    const quantity = Number(reservation.quantity)
    const claimed = await db.execute(sql`
      UPDATE inventory_reservations
      SET status = 'committed', committed_at = now(), updated_at = now()
      WHERE id = ${reservation.id} AND status = 'active'
      RETURNING id
    `)
    if (!rowsOf(claimed).length) continue
    const inventory = await db.execute(sql`
      UPDATE inventory
      SET on_hand = on_hand - ${quantity}, reserved = reserved - ${quantity}, updated_at = now()
      WHERE variant_id = ${variantID} AND reserved >= ${quantity} AND on_hand >= ${quantity}
      RETURNING id
    `)
    if (!rowsOf(inventory).length) throw new Error('Inventory reservation balance is inconsistent.')
    await req.payload.create({
      collection: 'inventory-movements',
      data: {
        note: 'Committed inventory for confirmed order.',
        occurredAt: new Date().toISOString(),
        quantityDelta: -quantity,
        reason: 'order_fulfilled',
        referenceId: String(orderID),
        referenceType: 'order',
        variant: variantID,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
  return { committed: reservations.docs.length }
}

export const releaseOrderReservations = async (
  req: PayloadRequest,
  orderID: number,
  status: 'expired' | 'released' = 'released',
) => {
  const db = await transactionDatabase(req)
  const reservations = await req.payload.find({
    collection: 'inventory-reservations',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: { and: [{ order: { equals: orderID } }, { status: { equals: 'active' } }] },
  })
  let released = 0
  for (const reservation of reservations.docs) {
    const claimed = await db.execute(sql`
      UPDATE inventory_reservations
      SET status = ${status}, released_at = now(), updated_at = now()
      WHERE id = ${reservation.id} AND status = 'active'
      RETURNING id
    `)
    if (!rowsOf(claimed).length) continue
    const variantID = Number(relationshipID(reservation.variant))
    const quantity = Number(reservation.quantity)
    const inventory = await db.execute(sql`
      UPDATE inventory
      SET reserved = reserved - ${quantity}, updated_at = now()
      WHERE variant_id = ${variantID} AND reserved >= ${quantity}
      RETURNING id
    `)
    if (!rowsOf(inventory).length) throw new Error('Inventory reservation balance is inconsistent.')
    released += 1
  }
  return { released }
}

export const restockCommittedOrder = async (req: PayloadRequest, orderID: number) => {
  const db = await transactionDatabase(req)
  const reservations = await req.payload.find({
    collection: 'inventory-reservations',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: { and: [{ order: { equals: orderID } }, { status: { equals: 'committed' } }] },
  })
  let restocked = 0
  for (const reservation of reservations.docs) {
    const claimed = await db.execute(sql`
      UPDATE inventory_reservations
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE id = ${reservation.id} AND status = 'committed'
      RETURNING id
    `)
    if (!rowsOf(claimed).length) continue
    const variantID = Number(relationshipID(reservation.variant))
    const quantity = Number(reservation.quantity)
    await db.execute(
      sql`UPDATE inventory SET on_hand = on_hand + ${quantity}, updated_at = now() WHERE variant_id = ${variantID}`,
    )
    await req.payload.create({
      collection: 'inventory-movements',
      data: {
        note: 'Restocked inventory after order cancellation.',
        occurredAt: new Date().toISOString(),
        quantityDelta: quantity,
        reason: 'order_cancelled',
        referenceId: String(orderID),
        referenceType: 'order',
        variant: variantID,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    restocked += 1
  }
  return { restocked }
}

export const expireReservations = async (req: PayloadRequest, limit = 100) =>
  withTransaction(req, async () => {
    const db = await transactionDatabase(req)
    const candidateRows = rowsOf(
      await db.execute(sql`
      SELECT id, order_id
      FROM inventory_reservations
      WHERE status = 'active' AND expires_at <= now()
      ORDER BY order_id, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(limit, 500))}
    `),
    )
    const candidates = [
      ...new Map(candidateRows.map((row) => [Number(row.order_id), row])).values(),
    ]
    let expiredOrders = 0
    for (const candidate of candidates) {
      const orderID = Number(candidate.order_id)
      await db.execute(sql`SELECT id FROM orders WHERE id = ${orderID} FOR UPDATE`)
      const order = await req.payload.findByID({
        collection: 'orders',
        id: orderID,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (order.paymentStatus === 'paid' || order.status !== 'pending_payment') continue
      await releaseOrderReservations(req, orderID, 'expired')
      // An unpaid order whose hold has ended is closed, so the customer is never left with an
      // order they can neither pay nor cancel. A payment that still arrives is flagged for review.
      const now = new Date().toISOString()
      await req.payload.update({
        collection: 'orders',
        id: orderID,
        data: {
          cancelledAt: now,
          exceptionCode: 'PAYMENT_RESERVATION_EXPIRED',
          paymentStatus: 'failed',
          status: 'cancelled',
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      await req.payload.create({
        collection: 'order-status-events',
        data: {
          actorType: 'system',
          eventType: 'order_cancelled',
          fromStatus: order.status,
          occurredAt: now,
          order: orderID,
          reason: 'Payment was not completed before the inventory hold expired.',
          toStatus: 'cancelled',
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      const redemptions = await req.payload.find({
        collection: 'coupon-redemptions',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        where: { order: { equals: orderID } },
      })
      if (redemptions.docs[0]?.status === 'allocated') {
        await req.payload.update({
          collection: 'coupon-redemptions',
          id: redemptions.docs[0].id,
          data: { releasedAt: new Date().toISOString(), status: 'released' },
          depth: 0,
          overrideAccess: true,
          req,
        })
      }
      expiredOrders += 1
    }
    return { expiredOrders }
  })
