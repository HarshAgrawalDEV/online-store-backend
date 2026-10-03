import { headersWithCors, type Endpoint, type PayloadRequest } from 'payload'

import { apiError } from '../lib/api-response'

import {
  CatalogQueryError,
  getCatalogProduct,
  listCatalogProducts,
  parseCatalogFilters,
} from '../services/catalog-query'

const json = (req: PayloadRequest, body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: headersWithCors({
      headers: new Headers({ 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }),
      req,
    }),
  })

const listProducts = async (req: PayloadRequest): Promise<Response> => {
  try {
    const filters = parseCatalogFilters(req.url ?? 'http://localhost')
    return json(req, await listCatalogProducts(req.payload, filters))
  } catch (error) {
    if (error instanceof CatalogQueryError)
      return apiError(req, 'VALIDATION_ERROR', error.message, 400)
    req.payload.logger.error({ err: error, msg: 'Catalog listing failed' })
    return apiError(req, 'INTERNAL_ERROR', 'Catalog listing is temporarily unavailable.', 500)
  }
}

const getProduct = async (req: PayloadRequest): Promise<Response> => {
  try {
    const identifier = decodeURIComponent(
      new URL(req.url ?? 'http://localhost').pathname.split('/').filter(Boolean).at(-1) ?? '',
    )
    if (!identifier)
      return apiError(req, 'VALIDATION_ERROR', 'Product identifier is required.', 400)
    const product = await getCatalogProduct(req.payload, identifier)
    return product ? json(req, product) : apiError(req, 'NOT_FOUND', 'Product not found.', 404)
  } catch (error) {
    req.payload.logger.error({ err: error, msg: 'Catalog product detail failed' })
    return apiError(req, 'INTERNAL_ERROR', 'Product detail is temporarily unavailable.', 500)
  }
}

export const catalogEndpoints: Endpoint[] = [
  { path: '/catalog/products', method: 'get', handler: listProducts },
  { path: '/catalog/products/:identifier', method: 'get', handler: getProduct },
]
