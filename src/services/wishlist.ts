import type { Payload, PayloadRequest } from 'payload'

import type { Inventory, Media, Product } from '../payload-types'

import { requireCustomer } from '../access/customers'
import { MobileAPIError } from '../lib/api-response'
import { relationshipID } from '../lib/catalog'
import { parseRouteID } from './addresses'

const findWishlist = (req: PayloadRequest, customerID: number | string) =>
  req.payload.find({
    collection: 'wishlists',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { customer: { equals: customerID } },
  })

const getWishlist = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  const existing = await findWishlist(req, customer.id)
  if (existing.docs[0]) return existing.docs[0]
  try {
    return await req.payload.create({
      collection: 'wishlists',
      data: { customer: customer.id as number, name: 'Saved Items' },
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // Two screens asked for the wishlist at once and the other request created it first.
    const winner = await findWishlist(req, customer.id)
    if (winner.docs[0]) return winner.docs[0]
    throw error
  }
}

const pagination = (req: PayloadRequest) => {
  const url = new URL(req.url ?? 'http://localhost')
  const page = Number(url.searchParams.get('page') ?? 1)
  const limit = Number(url.searchParams.get('limit') ?? 20)
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new MobileAPIError(
      'VALIDATION_ERROR',
      'page must be positive and limit must be between 1 and 50.',
    )
  }
  return { page, limit }
}

/**
 * Wishlist responses are built field by field. Ownership is checked with a privileged read
 * of the customer's own wishlist rows, but catalog data is loaded with normal access rules
 * (active products and variants only, no cost prices) and only these fields leave the server.
 */
export type WishlistProductSummary = {
  available: boolean
  category: null | string
  id: number
  imageUrl: null | string
  name: string
  priceRange: null | { maxPaise: number; minPaise: number }
  shortDescription: null | string
  slug: string
}

const mediaURL = (value: unknown): null | string => {
  if (!value || typeof value !== 'object') return null
  const media = value as Media
  return media.sizes?.card?.url ?? media.url ?? null
}

const availableQuantity = (inventory?: Inventory): number =>
  inventory?.stockStatus === 'available'
    ? Math.max(0, Number(inventory.onHand) - Number(inventory.reserved))
    : 0

const loadProductSummaries = async (
  payload: Payload,
  productIDs: number[],
): Promise<Map<number, WishlistProductSummary>> => {
  const summaries = new Map<number, WishlistProductSummary>()
  if (!productIDs.length) return summaries

  const products = await payload.find({
    collection: 'products',
    depth: 1,
    limit: productIDs.length,
    overrideAccess: false,
    pagination: false,
    where: { and: [{ id: { in: productIDs } }, { status: { equals: 'active' } }] },
  })
  const variants = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 1000,
    overrideAccess: false,
    pagination: false,
    where: { and: [{ product: { in: productIDs } }, { status: { equals: 'active' } }] },
  })
  const inventory = variants.docs.length
    ? await payload.find({
        collection: 'inventory',
        depth: 0,
        limit: variants.docs.length,
        overrideAccess: true,
        pagination: false,
        where: { variant: { in: variants.docs.map((variant) => variant.id) } },
      })
    : { docs: [] as Inventory[] }
  const stockByVariant = new Map(
    inventory.docs.map((record) => [String(relationshipID(record.variant)), record]),
  )

  for (const product of products.docs as Product[]) {
    const own = variants.docs.filter((variant) => relationshipID(variant.product) === product.id)
    const prices = own.map((variant) => variant.pricePaise)
    summaries.set(product.id, {
      available: own.some(
        (variant) => availableQuantity(stockByVariant.get(String(variant.id))) > 0,
      ),
      category: typeof product.primaryCategory === 'object' ? product.primaryCategory.name : null,
      id: product.id,
      imageUrl: mediaURL(product.featuredImage),
      name: product.name,
      priceRange: prices.length
        ? { maxPaise: Math.max(...prices), minPaise: Math.min(...prices) }
        : null,
      shortDescription: product.shortDescription ?? null,
      slug: product.slug,
    })
  }
  return summaries
}

export const listWishlist = async (req: PayloadRequest) => {
  const wishlist = await getWishlist(req)
  const { page, limit } = pagination(req)
  const result = await req.payload.find({
    collection: 'wishlist-items',
    depth: 0,
    limit,
    overrideAccess: true,
    page,
    req,
    sort: '-createdAt',
    where: { wishlist: { equals: wishlist.id } },
  })
  const productIDs = result.docs
    .map((item) => Number(relationshipID(item.product)))
    .filter((id) => Number.isSafeInteger(id))
  const summaries = await loadProductSummaries(req.payload, productIDs)

  // Items whose product is no longer active are simply omitted from the page.
  const docs = result.docs.flatMap((item) => {
    const productId = Number(relationshipID(item.product))
    const product = summaries.get(productId)
    return product ? [{ addedAt: item.createdAt, id: item.id, product, productId }] : []
  })
  return {
    docs,
    hasNextPage: result.hasNextPage,
    limit: result.limit,
    page: result.page,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    wishlistId: wishlist.id,
  }
}

export const addWishlistProduct = async (req: PayloadRequest, value: unknown) => {
  requireCustomer(req)
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  const productID = Number((value as Record<string, unknown>).productId)
  if (!Number.isSafeInteger(productID) || productID <= 0) {
    throw new MobileAPIError('VALIDATION_ERROR', 'productId must be a positive integer.')
  }
  const products = await req.payload.find({
    collection: 'products',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ id: { equals: productID } }, { status: { equals: 'active' } }] },
  })
  if (!products.docs[0]) throw new MobileAPIError('NOT_FOUND', 'Active product not found.', 404)

  const wishlist = await getWishlist(req)
  const existing = await req.payload.find({
    collection: 'wishlist-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ wishlist: { equals: wishlist.id } }, { product: { equals: productID } }] },
  })
  if (existing.docs[0])
    return { alreadySaved: true, itemId: existing.docs[0].id, productId: productID }
  let item
  try {
    item = await req.payload.create({
      collection: 'wishlist-items',
      data: { product: productID, wishlist: wishlist.id },
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // A double tap saved the same product first; treat the second tap as already saved.
    const winner = await req.payload.find({
      collection: 'wishlist-items',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { and: [{ wishlist: { equals: wishlist.id } }, { product: { equals: productID } }] },
    })
    if (winner.docs[0])
      return { alreadySaved: true, itemId: winner.docs[0].id, productId: productID }
    throw error
  }
  return { alreadySaved: false, itemId: item.id, productId: productID }
}

export const removeWishlistProduct = async (req: PayloadRequest) => {
  const productID = parseRouteID(req, 'productId')
  const wishlist = await getWishlist(req)
  const item = await req.payload.find({
    collection: 'wishlist-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { and: [{ wishlist: { equals: wishlist.id } }, { product: { equals: productID } }] },
  })
  if (!item.docs[0]) throw new MobileAPIError('NOT_FOUND', 'Wishlist item not found.', 404)
  await req.payload.delete({
    collection: 'wishlist-items',
    id: item.docs[0].id,
    overrideAccess: true,
    req,
  })
  return { productId: productID, removed: true }
}

export const checkWishlistProduct = async (req: PayloadRequest) => {
  const productID = parseRouteID(req, 'productId')
  const wishlist = await getWishlist(req)
  const result = await req.payload.count({
    collection: 'wishlist-items',
    overrideAccess: true,
    req,
    where: { and: [{ wishlist: { equals: wishlist.id } }, { product: { equals: productID } }] },
  })
  return { productId: productID, saved: result.totalDocs > 0 }
}
