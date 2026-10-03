import type { Endpoint } from 'payload'

import { apiSuccess, handleAPIError } from '../lib/api-response'
import {
  createAddress,
  deleteAddress,
  getDefaultAddress,
  listAddresses,
  parseRouteID,
  setDefaultAddress,
  updateAddress,
} from '../services/addresses'

export const addressEndpoints: Endpoint[] = [
  {
    path: '/addresses',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await listAddresses(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to list addresses.')
      }
    },
  },
  {
    path: '/addresses/default',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await getDefaultAddress(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to retrieve the default address.')
      }
    },
  },
  {
    path: '/addresses',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await createAddress(req, req.json ? await req.json() : undefined),
          'Address created.',
          201,
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to create address.')
      }
    },
  },
  {
    path: '/addresses/:id',
    method: 'patch',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await updateAddress(req, parseRouteID(req), req.json ? await req.json() : undefined),
          'Address updated.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to update address.')
      }
    },
  },
  {
    path: '/addresses/:id',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await deleteAddress(req, parseRouteID(req)), 'Address deleted.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to delete address.')
      }
    },
  },
  {
    path: '/addresses/:id/set-default',
    method: 'patch',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await setDefaultAddress(req, parseRouteID(req)),
          'Default address updated.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to set default address.')
      }
    },
  },
]
