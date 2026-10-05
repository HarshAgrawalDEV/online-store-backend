import type { Endpoint, PayloadRequest } from 'payload'

import { hasPermission } from '../access/permissions'
import { apiError, apiSuccess, handleAPIError } from '../lib/api-response'
import {
  applyDescriptionDraft,
  generateDescriptionDraft,
  parseDraftOptions,
} from '../services/description-draft'
import { generateVariants, parseGenerateVariants } from '../services/variant-generator'

const generateVariantsHandler = async (req: PayloadRequest): Promise<Response> => {
  if (!req.user) return apiError(req, 'AUTHENTICATION_REQUIRED', 'Authentication required.', 401)
  if (!hasPermission(req.user, 'catalog.manage')) {
    return apiError(req, 'FORBIDDEN', 'Catalog permission required.', 403)
  }
  const productID = Number(req.routeParams?.id)
  if (!Number.isSafeInteger(productID) || productID <= 0) {
    return apiError(req, 'INVALID_PRODUCT', 'Product id must be a positive whole number.', 400)
  }

  try {
    const input = parseGenerateVariants(req.json ? await req.json() : undefined)
    const result = await generateVariants(req, productID, input)
    return apiSuccess(
      req,
      result,
      `Created ${result.createdCount} variants, skipped ${result.skippedCount} that already existed.`,
      result.createdCount > 0 ? 201 : 200,
    )
  } catch (error) {
    return handleAPIError(req, error, 'Variant generation failed.')
  }
}

const staffProductAction =
  (action: (req: PayloadRequest, productID: number) => Promise<unknown>, message: string) =>
  async (req: PayloadRequest): Promise<Response> => {
    if (!req.user) return apiError(req, 'AUTHENTICATION_REQUIRED', 'Authentication required.', 401)
    if (!hasPermission(req.user, 'catalog.manage')) {
      return apiError(req, 'FORBIDDEN', 'Catalog permission required.', 403)
    }
    const productID = Number(req.routeParams?.id)
    if (!Number.isSafeInteger(productID) || productID <= 0) {
      return apiError(req, 'INVALID_PRODUCT', 'Product id must be a positive whole number.', 400)
    }
    try {
      return apiSuccess(req, await action(req, productID), message)
    } catch (error) {
      return handleAPIError(req, error, 'The request could not be completed.')
    }
  }

export const productAdminEndpoints: Endpoint[] = [
  {
    path: '/admin/products/:id/generate-variants',
    method: 'post',
    handler: generateVariantsHandler,
  },
  {
    path: '/admin/products/:id/generate-description',
    method: 'post',
    handler: staffProductAction(async (req, productID) => {
      const body = req.json ? await req.json().catch(() => undefined) : undefined
      return generateDescriptionDraft(req, productID, parseDraftOptions(body))
    }, 'Draft saved. Review it before using it.'),
  },
  {
    path: '/admin/products/:id/apply-description-draft',
    method: 'post',
    handler: staffProductAction(applyDescriptionDraft, 'Draft copied into the description.'),
  },
]
