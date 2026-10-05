import type { Endpoint } from 'payload'

import { apiSuccess, handleAPIError } from '../lib/api-response'
import { createStockAlert, listStockAlerts, removeStockAlert } from '../services/stock-alerts'

export const stockAlertEndpoints: Endpoint[] = [
  {
    path: '/my-stock-alerts',
    method: 'get',
    handler: async (req) => {
      try {
        return apiSuccess(req, await listStockAlerts(req))
      } catch (error) {
        return handleAPIError(req, error, 'Unable to load your stock alerts.')
      }
    },
  },
  {
    path: '/my-stock-alerts',
    method: 'post',
    handler: async (req) => {
      try {
        const body = req.json ? await req.json().catch(() => undefined) : undefined
        return apiSuccess(
          req,
          await createStockAlert(req, body),
          'We will show it in the app when it is back.',
          201,
        )
      } catch (error) {
        return handleAPIError(req, error, 'Unable to save your request.')
      }
    },
  },
  {
    path: '/my-stock-alerts/:variantId',
    method: 'delete',
    handler: async (req) => {
      try {
        return apiSuccess(req, await removeStockAlert(req), 'Request removed.')
      } catch (error) {
        return handleAPIError(req, error, 'Unable to remove your request.')
      }
    },
  },
]
