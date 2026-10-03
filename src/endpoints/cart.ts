import type { Endpoint } from 'payload'

import { apiSuccess, handleAPIError } from '../lib/api-response'
import {
  addCartItem,
  applyCartCoupon,
  clearCart,
  getCart,
  removeCartCoupon,
  removeCartItem,
  updateCartItem,
} from '../services/cart'

const requestBody = async (req: Parameters<Endpoint['handler']>[0]) =>
  req.json ? req.json() : undefined

export const cartEndpoints: Endpoint[] = [
  {
    path: '/cart',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await getCart(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retrieve cart.')
      }
    },
  },
  {
    path: '/cart/items',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(req, await addCartItem(req, await requestBody(req)), 'Cart updated.', 201)
      } catch (error) {
        return handleAPIError(req, error, 'Unable to add cart item.')
      }
    },
  },
  {
    path: '/cart/items/:itemId',
    method: 'patch',
    handler: async (req) => {
      try {
        return apiSuccess(req, await updateCartItem(req, await requestBody(req)), 'Cart updated.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to update cart item.')
      }
    },
  },
  {
    path: '/cart/items/:itemId',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await removeCartItem(req), 'Cart item removed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to remove cart item.')
      }
    },
  },
  {
    path: '/cart',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await clearCart(req), 'Cart cleared.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to clear cart.')
      }
    },
  },
  {
    path: '/cart/apply-coupon',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await applyCartCoupon(req, await requestBody(req)),
          'Coupon applied.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to apply coupon.')
      }
    },
  },
  {
    path: '/cart/coupon',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await removeCartCoupon(req), 'Coupon removed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to remove coupon.')
      }
    },
  },
]
