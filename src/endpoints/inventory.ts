import type { Endpoint, PayloadRequest } from 'payload'

import { isInventoryStaff } from '../access/catalog'
import { apiError, apiSuccess, handleAPIError } from '../lib/api-response'
import {
  adjustInventory,
  InventoryAdjustmentConflictError,
  InventoryAdjustmentError,
  parseInventoryAdjustment,
} from '../services/inventory'

const handler = async (req: PayloadRequest): Promise<Response> => {
  if (!req.user) return apiError(req, 'AUTHENTICATION_REQUIRED', 'Authentication required.', 401)
  if (!isInventoryStaff(req.user)) {
    return apiError(req, 'FORBIDDEN', 'Inventory permission required.', 403)
  }

  try {
    const adjustment = parseInventoryAdjustment(req.json ? await req.json() : undefined)
    const inventory = await adjustInventory(req, adjustment)
    return apiSuccess(req, { inventory }, 'Inventory adjusted.')
  } catch (error) {
    if (error instanceof InventoryAdjustmentConflictError) {
      return apiError(req, 'OPERATION_ID_REUSED', error.message, 409)
    }
    if (error instanceof InventoryAdjustmentError) {
      return apiError(req, 'INVALID_ADJUSTMENT', error.message, 400)
    }
    return handleAPIError(req, error, 'Inventory adjustment failed.')
  }
}

export const inventoryAdjustmentEndpoint: Endpoint = {
  path: '/admin/inventory/adjust',
  method: 'post',
  handler,
}
