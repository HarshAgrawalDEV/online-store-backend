import { createHash, randomUUID } from 'node:crypto'
import type { PaymentAttempt } from '../../payload-types'
import type { PayloadRequest } from 'payload'

import { requireCustomer } from '../../access/customers'
import { MobileAPIError } from '../../lib/api-response'
import { relationshipID } from '../../lib/catalog'
import { redeemOrderCoupon } from '../coupons/redemptions'
import { withTransaction } from '../database/transaction'
import { commitOrderReservations } from '../inventory/reservations'
import { getOrderDetails, lockOrder } from '../orders/order-service'
import { paymentProvider } from './razorpay.provider'
import type { ProviderPayment } from './payment-provider'

const bodyObject = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object')
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  return input as Record<string, unknown>
}

const paymentAttemptByProviderOrder = async (req: PayloadRequest, providerOrderID: string) => {
  const result = await req.payload.find({
    collection: 'payment-attempts',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { providerOrderId: { equals: providerOrderID } },
  })
  if (!result.docs[0])
    throw new MobileAPIError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found.', 404)
  return result.docs[0]
}

const validateProviderPayment = (attempt: PaymentAttempt, payment: ProviderPayment) => {
  if (
    payment.orderId !== attempt.providerOrderId ||
    payment.amountPaise !== attempt.amountPaise ||
    payment.currency !== attempt.currency
  ) {
    throw new MobileAPIError(
      'PAYMENT_MISMATCH',
      'Payment does not match the expected order, amount, or currency.',
      409,
    )
  }
  if (!payment.captured || payment.status !== 'captured')
    throw new MobileAPIError('PAYMENT_NOT_CAPTURED', 'Payment has not been captured.', 409)
}

export const finalizeCapturedPayment = async (
  req: PayloadRequest,
  attemptID: number,
  payment: ProviderPayment,
) =>
  withTransaction(req, async () => {
    const attempt = await req.payload.findByID({
      collection: 'payment-attempts',
      id: attemptID,
      depth: 0,
      overrideAccess: true,
      req,
    })
    validateProviderPayment(attempt, payment)
    const orderID = Number(relationshipID(attempt.order))
    // Verify endpoint and webhook can arrive together; the row lock makes the second one wait,
    // then see the order already paid.
    const order = await lockOrder(req, orderID)
    if (attempt.status === 'paid' && order.paymentStatus === 'paid') return order
    const now = new Date().toISOString()
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: {
        completedAt: now,
        lastVerifiedAt: now,
        providerPaymentId: payment.id,
        status: 'paid',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    const reservations = await req.payload.find({
      collection: 'inventory-reservations',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
      where: { order: { equals: order.id } },
    })
    const active = reservations.docs.filter((reservation) => reservation.status === 'active')
    const expired =
      active.length === 0 ||
      active.some((reservation) => new Date(reservation.expiresAt).getTime() <= Date.now())
    if (expired && order.status !== 'confirmed') {
      const exceptionOrder = await req.payload.update({
        collection: 'orders',
        id: order.id,
        data: { exceptionCode: 'LATE_PAYMENT_REQUIRES_RECONCILIATION', paymentStatus: 'paid' },
        depth: 0,
        overrideAccess: true,
        req,
      })
      await req.payload.create({
        collection: 'order-status-events',
        data: {
          actorType: 'system',
          eventType: 'late_payment_exception',
          fromStatus: order.status,
          metadata: { providerPaymentId: payment.id },
          occurredAt: now,
          order: order.id,
          reason: 'Payment captured after the inventory hold ended.',
          toStatus: order.status,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return exceptionOrder
    }
    await commitOrderReservations(req, order.id)
    await redeemOrderCoupon(req, order.id)
    const confirmed = await req.payload.update({
      collection: 'orders',
      id: order.id,
      data: { confirmedAt: now, exceptionCode: null, paymentStatus: 'paid', status: 'confirmed' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    if (order.status !== 'confirmed') {
      await req.payload.create({
        collection: 'order-status-events',
        data: {
          actorType: 'system',
          eventType: 'payment_verified',
          fromStatus: order.status,
          metadata: { providerPaymentId: payment.id },
          occurredAt: now,
          order: order.id,
          toStatus: 'confirmed',
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
    }
    return confirmed
  })

export const verifyCustomerPayment = async (req: PayloadRequest, input: unknown) => {
  const customer = requireCustomer(req)
  const body = bodyObject(input)
  const providerOrderID = String(body.razorpayOrderId ?? '')
  const providerPaymentID = String(body.razorpayPaymentId ?? '')
  const signature = String(body.razorpaySignature ?? '')
  if (!providerOrderID || !providerPaymentID || !signature)
    throw new MobileAPIError('VALIDATION_ERROR', 'Payment IDs and signature are required.')
  const provider = paymentProvider()
  provider.assertConfigured()
  const attempt = await paymentAttemptByProviderOrder(req, providerOrderID)
  const order = await req.payload.findByID({
    collection: 'orders',
    id: Number(relationshipID(attempt.order)),
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (String(relationshipID(order.customer)) !== String(customer.id))
    throw new MobileAPIError('PAYMENT_ATTEMPT_NOT_FOUND', 'Payment attempt was not found.', 404)
  if (!provider.verifyCheckoutSignature(providerOrderID, providerPaymentID, signature))
    throw new MobileAPIError('INVALID_PAYMENT_SIGNATURE', 'Payment signature is invalid.', 400)
  const payment = await provider.fetchPayment(providerPaymentID)
  const updated = await finalizeCapturedPayment(req, attempt.id, payment)
  return { order: await getOrderDetails(req, updated), verified: true }
}

export const retryPayment = async (req: PayloadRequest, orderID: number) => {
  const customer = requireCustomer(req)
  const orderResult = await req.payload.find({
    collection: 'orders',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ id: { equals: orderID } }, { customer: { equals: customer.id } }] },
  })
  const order = orderResult.docs[0]
  if (!order) throw new MobileAPIError('ORDER_NOT_FOUND', 'Order was not found.', 404)
  if (
    order.paymentMethod === 'cod' ||
    order.paymentStatus === 'paid' ||
    order.status === 'cancelled'
  )
    throw new MobileAPIError(
      'PAYMENT_RETRY_NOT_ALLOWED',
      'This order is not eligible for payment retry.',
      409,
    )
  const reservations = await req.payload.find({
    collection: 'inventory-reservations',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: { and: [{ order: { equals: order.id } }, { status: { equals: 'active' } }] },
  })
  if (
    !reservations.docs.length ||
    reservations.docs.some((reservation) => new Date(reservation.expiresAt).getTime() <= Date.now())
  )
    throw new MobileAPIError('RESERVATION_EXPIRED', 'The inventory reservation has expired.', 409)
  const attempts = await req.payload.find({
    collection: 'payment-attempts',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    sort: '-initiatedAt',
    where: { order: { equals: order.id } },
  })
  const latest = attempts.docs[0]
  if (latest?.status === 'pending' && !latest.providerOrderId) {
    // The gateway never confirmed an order id for this attempt, so the customer has nothing to
    // pay against. Abandon it and start a clean attempt rather than blocking the order.
    await req.payload.update({
      collection: 'payment-attempts',
      id: latest.id,
      data: {
        completedAt: new Date().toISOString(),
        failureCode: 'GATEWAY_INITIALIZATION_ABANDONED',
        status: 'failed',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    latest.status = 'failed'
  }
  if (
    latest &&
    ['created', 'pending', 'authorized'].includes(latest.status) &&
    latest.providerOrderId
  ) {
    return {
      amountPaise: latest.amountPaise,
      attemptId: latest.id,
      clientKey: paymentProvider().clientKey,
      currency: latest.currency,
      provider: latest.provider,
      providerOrderId: latest.providerOrderId,
      reused: true,
    }
  }
  const provider = paymentProvider()
  provider.assertConfigured()
  const attempt = await req.payload.create({
    collection: 'payment-attempts',
    data: {
      amountPaise: order.grandTotalPaise,
      currency: 'INR',
      idempotencyKey: `${order.idempotencyKey}:retry:${attempts.totalDocs + 1}:${randomUUID()}`,
      initiatedAt: new Date().toISOString(),
      order: order.id,
      paymentMethod: order.paymentMethod,
      provider: 'razorpay',
      status: 'created',
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
  try {
    const providerOrder = await provider.createOrder({
      amountPaise: order.grandTotalPaise,
      currency: 'INR',
      receipt: `${order.orderNumber}-${attempt.id}`,
    })
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: { providerOrderId: providerOrder.id, status: 'pending' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    await req.payload.update({
      collection: 'orders',
      id: order.id,
      data: { paymentStatus: 'pending' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return {
      amountPaise: order.grandTotalPaise,
      attemptId: attempt.id,
      clientKey: provider.clientKey,
      currency: 'INR',
      provider: provider.name,
      providerOrderId: providerOrder.id,
      reused: false,
    }
  } catch (error) {
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: {
        failureCode: 'GATEWAY_INITIALIZATION_UNCERTAIN',
        failureMessage: 'Gateway order creation did not complete; reconcile before retry.',
        status: 'pending',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    throw error
  }
}

type RazorpayWebhook = {
  event?: string
  payload?: {
    payment?: {
      entity?: {
        amount?: number
        captured?: boolean
        currency?: string
        id?: string
        order_id?: string
        status?: string
      }
    }
  }
}

export const processRazorpayWebhook = async (req: PayloadRequest, rawBody: string) => {
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const provider = paymentProvider()
  if (!signature || !provider.verifyWebhookSignature(rawBody, signature))
    throw new MobileAPIError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid.', 401)
  let event: RazorpayWebhook
  try {
    event = JSON.parse(rawBody) as RazorpayWebhook
  } catch {
    throw new MobileAPIError('INVALID_WEBHOOK_BODY', 'Webhook body is invalid.')
  }
  const externalEventID =
    req.headers.get('x-razorpay-event-id') ?? createHash('sha256').update(rawBody).digest('hex')
  const duplicate = await req.payload.find({
    collection: 'payment-webhook-events',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: {
      and: [{ provider: { equals: 'razorpay' } }, { externalEventId: { equals: externalEventID } }],
    },
  })
  if (duplicate.docs[0]?.status === 'processed' || duplicate.docs[0]?.status === 'ignored')
    return { duplicate: true, processed: true }
  const paymentEntity = event.payload?.payment?.entity
  const ledger =
    duplicate.docs[0] ??
    (await req.payload.create({
      collection: 'payment-webhook-events',
      data: {
        externalEventId: externalEventID,
        kind: event.event ?? 'unknown',
        payloadRedacted: {
          paymentId: paymentEntity?.id,
          providerOrderId: paymentEntity?.order_id,
          status: paymentEntity?.status,
        },
        provider: 'razorpay',
        signatureVerified: true,
        status: 'received',
      },
      depth: 0,
      overrideAccess: true,
      req,
    }))
  if (!paymentEntity?.order_id || !paymentEntity.id) {
    await req.payload.update({
      collection: 'payment-webhook-events',
      id: ledger.id,
      data: { processedAt: new Date().toISOString(), status: 'ignored' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return { duplicate: false, processed: false }
  }
  let attempt: PaymentAttempt
  try {
    attempt = await paymentAttemptByProviderOrder(req, paymentEntity.order_id)
  } catch (error) {
    // Not one of our gateway orders. Acknowledge it so the provider stops retrying.
    if (error instanceof MobileAPIError && error.code === 'PAYMENT_ATTEMPT_NOT_FOUND') {
      await req.payload.update({
        collection: 'payment-webhook-events',
        id: ledger.id,
        data: { processedAt: new Date().toISOString(), status: 'ignored' },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return { duplicate: false, processed: false }
    }
    throw error
  }
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    await finalizeCapturedPayment(req, attempt.id, {
      amountPaise: Number(paymentEntity.amount),
      captured: Boolean(paymentEntity.captured) || paymentEntity.status === 'captured',
      currency: String(paymentEntity.currency),
      id: paymentEntity.id,
      orderId: paymentEntity.order_id,
      status: String(paymentEntity.status),
    })
  } else if (event.event === 'payment.failed' && attempt.status !== 'paid') {
    await req.payload.update({
      collection: 'payment-attempts',
      id: attempt.id,
      data: {
        completedAt: new Date().toISOString(),
        failureCode: 'PROVIDER_PAYMENT_FAILED',
        status: 'failed',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    const orderID = Number(relationshipID(attempt.order))
    const order = await req.payload.findByID({
      collection: 'orders',
      id: orderID,
      depth: 0,
      overrideAccess: true,
      req,
    })
    if (order.paymentStatus !== 'paid')
      await req.payload.update({
        collection: 'orders',
        id: orderID,
        data: { paymentStatus: 'failed' },
        depth: 0,
        overrideAccess: true,
        req,
      })
  } else {
    await req.payload.update({
      collection: 'payment-webhook-events',
      id: ledger.id,
      data: { processedAt: new Date().toISOString(), status: 'ignored' },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return { duplicate: false, processed: false }
  }
  await req.payload.update({
    collection: 'payment-webhook-events',
    id: ledger.id,
    data: { processedAt: new Date().toISOString(), status: 'processed' },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return { duplicate: false, processed: true }
}

/**
 * Settles payments whose confirmation never reached us (app closed mid-payment and the webhook
 * was lost or delayed). For each gateway attempt still open after a grace period, ask the gateway
 * what happened and finalise any captured payment through the same path as verify and webhooks.
 */
export const reconcilePendingPayments = async (
  req: PayloadRequest,
  options: { limit?: number; olderThanMs?: number } = {},
) => {
  const { limit = 50, olderThanMs = 2 * 60_000 } = options
  const provider = paymentProvider()
  provider.assertConfigured()
  const cutoff = new Date(Date.now() - olderThanMs).toISOString()
  const open = await req.payload.find({
    collection: 'payment-attempts',
    depth: 0,
    limit,
    overrideAccess: true,
    req,
    sort: 'initiatedAt',
    where: {
      and: [
        { status: { in: ['created', 'pending', 'authorized'] } },
        { providerOrderId: { exists: true } },
        { initiatedAt: { less_than: cutoff } },
      ],
    },
  })
  let settled = 0
  let failed = 0
  for (const attempt of open.docs) {
    try {
      const payments = await provider.fetchOrderPayments(String(attempt.providerOrderId))
      const captured = payments.find((payment) => payment.captured && payment.status === 'captured')
      if (!captured) continue
      await finalizeCapturedPayment(req, attempt.id, captured)
      settled += 1
    } catch (error) {
      failed += 1
      req.payload.logger.error({
        err: error,
        msg: 'Payment reconciliation failed for an attempt',
        attemptId: attempt.id,
      })
    }
  }
  return { checked: open.docs.length, failed, settled }
}
