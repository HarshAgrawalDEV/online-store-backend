import type { Endpoint } from 'payload'

import { apiSuccess, handleAPIError } from '../lib/api-response'
import {
  addWishlistProduct,
  checkWishlistProduct,
  listWishlist,
  removeWishlistProduct,
} from '../services/wishlist'

export const wishlistEndpoints: Endpoint[] = [
  {
    path: '/wishlist',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await listWishlist(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retrieve wishlist.')
      }
    },
  },
  {
    path: '/wishlist/check/:productId',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await checkWishlistProduct(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to check wishlist.')
      }
    },
  },
  {
    path: '/wishlist/items',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await addWishlistProduct(req, req.json ? await req.json() : undefined),
          'Product saved.',
          201,
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to save product.')
      }
    },
  },
  {
    path: '/wishlist/items/:productId',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await removeWishlistProduct(req), 'Product removed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to remove product.')
      }
    },
  },
]
