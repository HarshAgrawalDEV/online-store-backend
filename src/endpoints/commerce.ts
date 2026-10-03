import type { Endpoint, PayloadRequest } from 'payload'

import { canManageOrders } from '../access/commerce'
import { apiSuccess, handleAPIError, MobileAPIError } from '../lib/api-response'
import { checkoutPreview, publicCheckoutPreview } from '../services/checkout/pricing'
import { runMaintenance } from '../jobs/maintenance'
import { expireReservations } from '../services/inventory/reservations'
import {
  adminTransitionOrder,
  cancelCustomerOrder,
  getCustomerOrder,
  listCustomerOrders,
  placeOrder,
} from '../services/orders/order-service'
import {
  processRazorpayWebhook,
  retryPayment,
  verifyCustomerPayment,
} from '../services/payments/payment-service'

const body = async (req: PayloadRequest): Promise<unknown> => (req.json ? req.json() : undefined)
const id = (req: PayloadRequest): number => {
  const value = Number(req.routeParams?.id)
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new MobileAPIError('VALIDATION_ERROR', 'Order ID is invalid.')
  return value
}

export const commerceEndpoints: Endpoint[] = [
  {
    path: '/checkout/preview',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          publicCheckoutPreview(await checkoutPreview(req, await body(req))),
          'Checkout preview calculated.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to preview checkout.')
      }
    },
  },
  {
    path: '/checkout/place-order',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(req, await placeOrder(req, await body(req)), 'Order placed.', 201)
      } catch (error) {
        return handleAPIError(req, error, 'Unable to place order.')
      }
    },
  },
  {
    path: '/my-orders',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await listCustomerOrders(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retrieve orders.')
      }
    },
  },
  {
    path: '/my-orders/:id',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await getCustomerOrder(req, id(req)))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retrieve order.')
      }
    },
  },
  {
    path: '/my-orders/:id/cancel',
    method: 'post',
    handler: async (req) => {
      try {
        const input = (await body(req)) as { reason?: unknown } | undefined
        return apiSuccess(
          req,
          await cancelCustomerOrder(
            req,
            id(req),
            typeof input?.reason === 'string' ? input.reason.slice(0, 500) : undefined,
          ),
          'Order cancelled.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to cancel order.')
      }
    },
  },
  {
    path: '/my-orders/:id/retry-payment',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(req, await retryPayment(req, id(req)), 'Payment retry initialized.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retry payment.')
      }
    },
  },
  {
    path: '/payments/verify',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await verifyCustomerPayment(req, await body(req)),
          'Payment verified.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to verify payment.')
      }
    },
  },
  {
    path: '/payments/webhooks/razorpay',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await processRazorpayWebhook(req, req.text ? await req.text() : ''),
          'Webhook accepted.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to process payment webhook.')
      }
    },
  },
  {
    path: '/admin/orders/:id/status',
    method: 'post',
    handler: async (req) => {
      try {
        const input = (await body(req)) as { reason?: unknown; status?: unknown } | undefined
        return apiSuccess(
          req,
          await adminTransitionOrder(
            req,
            id(req),
            String(input?.status ?? ''),
            typeof input?.reason === 'string' ? input.reason.slice(0, 500) : undefined,
          ),
          'Order status updated.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to update order status.')
      }
    },
  },
  {
    path: '/admin/inventory-reservations/expire',
    method: 'post',
    handler: async (req) => {
      try {
        if (!canManageOrders(req.user))
          throw new MobileAPIError('FORBIDDEN', 'Order manager access is required.', 403)
        return apiSuccess(req, await expireReservations(req), 'Expired reservations processed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to expire inventory reservations.')
      }
    },
  },
  {
    path: '/admin/maintenance/run',
    method: 'post',
    handler: async (req) => {
      try {
        if (!canManageOrders(req.user))
          throw new MobileAPIError('FORBIDDEN', 'Order manager access is required.', 403)
        return apiSuccess(req, await runMaintenance(req.payload), 'Maintenance completed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to run maintenance.')
      }
    },
  },
]
