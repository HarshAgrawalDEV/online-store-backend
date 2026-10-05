import { headersWithCors, type Endpoint, type PayloadRequest } from 'payload'

import type { Department } from '../lib/jewellery'
import { apiError } from '../lib/api-response'

import {
  CatalogQueryError,
  getCatalogFacets,
  getCatalogProduct,
  listCatalogProducts,
  parseCatalogFilters,
} from '../services/catalog-query'
import { logSearch, suggestProducts } from '../services/search/query'

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
    const page = await listCatalogProducts(req.payload, filters)
    if (filters.search && filters.page === 1) {
      logSearch(
        req.payload,
        filters.search,
        page.totalDocs,
        'search' in page ? page.search.relaxed : false,
      )
    }
    return json(req, page)
  } catch (error) {
    if (error instanceof CatalogQueryError)
      return apiError(req, 'VALIDATION_ERROR', error.message, 400)
    req.payload.logger.error({ err: error, msg: 'Catalog listing failed' })
    return apiError(req, 'INTERNAL_ERROR', 'Catalog listing is temporarily unavailable.', 500)
  }
}

/** Product names that match what the customer has typed so far, for the search box. */
const suggest = async (req: PayloadRequest): Promise<Response> => {
  try {
    const text = new URL(req.url ?? 'http://localhost').searchParams.get('q')?.trim() ?? ''
    const suggestions = await suggestProducts(req.payload, text)
    return json(req, { suggestions })
  } catch (error) {
    // Suggestions are a convenience: failing quietly keeps the search box usable.
    req.payload.logger.warn({ err: error, msg: 'Search suggestions failed' })
    return json(req, { suggestions: [] })
  }
}

const parseFacetDepartment = (url?: string): Department | undefined => {
  const value = url ? new URL(url).searchParams.get('department')?.toLowerCase() : undefined
  return value === 'bangles' || value === 'jewellery' ? value : undefined
}

const listFilters = async (req: PayloadRequest): Promise<Response> => {
  try {
    return json(req, await getCatalogFacets(req.payload, parseFacetDepartment(req.url)))
  } catch (error) {
    req.payload.logger.error({ err: error, msg: 'Catalog filters failed' })
    return apiError(req, 'INTERNAL_ERROR', 'Catalog filters are temporarily unavailable.', 500)
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
  { path: '/catalog/filters', method: 'get', handler: listFilters },
  { path: '/catalog/search/suggest', method: 'get', handler: suggest },
  { path: '/catalog/products', method: 'get', handler: listProducts },
  { path: '/catalog/products/:identifier', method: 'get', handler: getProduct },
]
