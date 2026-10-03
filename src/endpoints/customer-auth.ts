import type { Endpoint, PayloadRequest } from 'payload'

import { apiSuccess, handleAPIError } from '../lib/api-response'
import {
  changeCustomerPassword,
  registerCustomer,
  updateCustomerProfile,
} from '../services/customer-auth'

const body = async (req: PayloadRequest): Promise<unknown> =>
  req.json ? req.json() : Promise.resolve(undefined)

export const customerAuthEndpoints: Endpoint[] = [
  {
    path: '/customer-auth/register',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await registerCustomer(req, await body(req)),
          'Customer registered.',
          201,
        )
      } catch (error) {
        return handleAPIError(req, error, 'Customer registration failed.')
      }
    },
  },
  {
    path: '/customer-auth/change-password',
    method: 'post',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await changeCustomerPassword(req, await body(req)),
          'Password changed.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to change password.')
      }
    },
  },
]

export const customerCollectionEndpoints: Endpoint[] = [
  {
    path: '/me',
    method: 'patch',
    handler: async (req) => {
      try {
        return apiSuccess(
          req,
          await updateCustomerProfile(req, await body(req)),
          'Profile updated.',
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to update customer profile.')
      }
    },
  },
]
