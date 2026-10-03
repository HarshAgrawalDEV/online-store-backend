import { createLocalReq, type Payload } from 'payload'

import { expireReservations } from '../services/inventory/reservations'
import { reconcilePendingPayments } from '../services/payments/payment-service'

/**
 * Periodic commerce housekeeping:
 *  - release inventory held by unpaid orders whose payment window has ended,
 *  - settle online payments whose confirmation never reached us.
 *
 * Both operations are safe to run from several instances at once (row locks, SKIP LOCKED and
 * idempotent finalisation), so no leader election is needed.
 */
export const runMaintenance = async (payload: Payload) => {
  const result = { expired: 0, reconciled: 0 }
  try {
    const req = await createLocalReq({}, payload)
    result.expired = (await expireReservations(req)).expiredOrders
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Reservation expiry sweep failed' })
  }
  try {
    const req = await createLocalReq({}, payload)
    result.reconciled = (await reconcilePendingPayments(req)).settled
  } catch (error) {
    // Reconciliation needs gateway credentials; without them there is simply nothing to settle.
    payload.logger.warn({ err: error, msg: 'Payment reconciliation skipped' })
  }
  return result
}

const STARTED = Symbol.for('jewelry.maintenance.started')

export const startMaintenanceLoop = (payload: Payload, intervalMs = 60_000): void => {
  if (process.env.MAINTENANCE_JOBS_ENABLED === 'false') return
  const globals = globalThis as unknown as Record<symbol, unknown>
  if (globals[STARTED]) return // survives hot reloads in development
  globals[STARTED] = true
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void runMaintenance(payload).finally(() => {
      running = false
    })
  }, intervalMs)
  timer.unref?.()
}
