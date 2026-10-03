import type { Inventory, Product, ProductVariant } from '../payload-types'
import type { Payload, Where } from 'payload'

import { relationshipID } from '../lib/catalog'

const MAX_PAGE_SIZE = 50
const MAX_MATCHED_PRODUCTS = 500

export class CatalogQueryError extends Error {}

export type CatalogFilters = {
  available?: boolean
  category?: number
  collection?: number
  color?: string
  limit: number
  material?: string
  maxPrice?: number
  minPrice?: number
  occasion?: string
  page: number
  search?: string
  size?: string
  sort: 'name' | 'newest' | 'price-high' | 'price-low'
}

const optionalInteger = (params: URLSearchParams, key: string, minimum = 0): number | undefined => {
  const raw = params.get(key)
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CatalogQueryError(
      `${key} must be a whole number greater than or equal to ${minimum}.`,
    )
  }
  return value
}

export const parseCatalogFilters = (url: string): CatalogFilters => {
  const params = new URL(url).searchParams
  const page = optionalInteger(params, 'page', 1) ?? 1
  const limit = optionalInteger(params, 'limit', 1) ?? 20
  if (limit > MAX_PAGE_SIZE) throw new CatalogQueryError(`limit cannot exceed ${MAX_PAGE_SIZE}.`)

  const sort = params.get('sort') ?? 'newest'
  if (!['name', 'newest', 'price-high', 'price-low'].includes(sort)) {
    throw new CatalogQueryError('sort must be name, newest, price-low, or price-high.')
  }

  const minPrice = optionalInteger(params, 'minPrice')
  const maxPrice = optionalInteger(params, 'maxPrice')
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new CatalogQueryError('minPrice cannot exceed maxPrice.')
  }

  const available = params.get('available')
  if (available !== null && !['true', 'false'].includes(available)) {
    throw new CatalogQueryError('available must be true or false.')
  }

  return {
    available: available === null ? undefined : available === 'true',
    category: optionalInteger(params, 'category', 1),
    collection: optionalInteger(params, 'collection', 1),
    color: params.get('color')?.trim().toLowerCase() || undefined,
    limit,
    material: params.get('material')?.trim() || undefined,
    maxPrice,
    minPrice,
    occasion: params.get('occasion')?.trim().toLowerCase() || undefined,
    page,
    search: params.get('search')?.trim() || undefined,
    size: params.get('size')?.trim() || undefined,
    sort: sort as CatalogFilters['sort'],
  }
}

const availableQuantity = (inventory?: Inventory): number =>
  inventory?.stockStatus === 'available'
    ? Math.max(0, Number(inventory.onHand) - Number(inventory.reserved))
    : 0

const publicVariant = (variant: ProductVariant, inventory?: Inventory) => {
  const { costPaise: _costPaise, ...safeVariant } = variant
  return {
    ...safeVariant,
    availability: {
      available: availableQuantity(inventory) > 0,
      quantity: availableQuantity(inventory),
    },
  }
}

const productIDFromVariant = (variant: ProductVariant): number | string | undefined =>
  relationshipID(variant.product)

const inventoryByVariant = (records: Inventory[]): Map<string, Inventory> =>
  new Map(
    records
      .map((record) => [relationshipID(record.variant), record] as const)
      .filter((entry): entry is readonly [number | string, Inventory] => entry[0] !== undefined)
      .map(([id, record]) => [String(id), record]),
  )

const variantsByProduct = (variants: ProductVariant[]): Map<string, ProductVariant[]> => {
  const grouped = new Map<string, ProductVariant[]>()
  for (const variant of variants) {
    const productID = productIDFromVariant(variant)
    if (productID === undefined) continue
    const key = String(productID)
    grouped.set(key, [...(grouped.get(key) ?? []), variant])
  }
  return grouped
}

const loadInventory = async (
  payload: Payload,
  variants: ProductVariant[],
): Promise<Inventory[]> => {
  const variantIDs = variants.map((variant) => variant.id)
  if (variantIDs.length === 0) return []

  const result = await payload.find({
    collection: 'inventory',
    depth: 0,
    limit: variantIDs.length,
    overrideAccess: true,
    pagination: false,
    where: { variant: { in: variantIDs } },
  })
  return result.docs
}

const productWhere = (filters: CatalogFilters): Where => {
  const and: Where[] = [{ status: { equals: 'active' } }]
  if (filters.category) {
    and.push({
      or: [
        { primaryCategory: { equals: filters.category } },
        { categories: { contains: filters.category } },
      ],
    })
  }
  if (filters.collection) and.push({ collections: { contains: filters.collection } })
  if (filters.material) and.push({ 'jewelryDetails.material': { contains: filters.material } })
  if (filters.occasion) and.push({ 'occasions.occasion': { equals: filters.occasion } })
  if (filters.search) {
    and.push({
      or: [
        { name: { contains: filters.search } },
        { shortDescription: { contains: filters.search } },
        { 'jewelryDetails.material': { contains: filters.search } },
        { 'jewelryDetails.plating': { contains: filters.search } },
        { 'jewelryDetails.stoneType': { contains: filters.search } },
      ],
    })
  }
  return { and }
}

const variantWhere = (filters: CatalogFilters): Where => {
  const and: Where[] = [{ status: { equals: 'active' } }]
  if (filters.color) and.push({ colorCode: { equals: filters.color } })
  if (filters.size) and.push({ sizeCode: { equals: filters.size } })
  if (filters.minPrice !== undefined)
    and.push({ pricePaise: { greater_than_equal: filters.minPrice } })
  if (filters.maxPrice !== undefined)
    and.push({ pricePaise: { less_than_equal: filters.maxPrice } })
  return { and }
}

const hasVariantFilters = (filters: CatalogFilters): boolean =>
  Boolean(
    filters.color ||
    filters.size ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    filters.available !== undefined,
  )

const buildCatalogDocuments = (
  products: Product[],
  variants: ProductVariant[],
  inventories: Inventory[],
) => {
  const groupedVariants = variantsByProduct(variants)
  const inventoryMap = inventoryByVariant(inventories)

  return products.map((product) => {
    const productVariants = groupedVariants.get(String(product.id)) ?? []
    const prices = productVariants.map(({ pricePaise }) => pricePaise)
    const safeVariants = productVariants.map((variant) =>
      publicVariant(variant, inventoryMap.get(String(variant.id))),
    )

    return {
      ...product,
      priceRange: prices.length
        ? { minPaise: Math.min(...prices), maxPaise: Math.max(...prices) }
        : null,
      available: safeVariants.some((variant) => variant.availability.available),
      variants: safeVariants,
    }
  })
}

/**
 * Fast path for the common listing (no variant filters, name/newest order): the database
 * paginates products and only the current page of variants and stock is loaded. Price sorting
 * and variant filters still need every candidate's variants, so they use the bounded path below.
 */
const listPaginatedByDatabase = async (payload: Payload, filters: CatalogFilters) => {
  const productResult = await payload.find({
    collection: 'products',
    depth: 2,
    limit: filters.limit,
    overrideAccess: false,
    page: filters.page,
    sort: filters.sort === 'name' ? 'name' : '-publishedAt',
    where: productWhere(filters),
  })
  const productIDs = productResult.docs.map(({ id }) => id)
  let variants: ProductVariant[] = []
  if (productIDs.length) {
    variants = (
      await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: 1000,
        overrideAccess: false,
        pagination: false,
        where: { and: [{ product: { in: productIDs } }, { status: { equals: 'active' } }] },
      })
    ).docs
  }
  const inventories = await loadInventory(payload, variants)
  return {
    docs: buildCatalogDocuments(productResult.docs, variants, inventories),
    hasNextPage: productResult.hasNextPage,
    hasPrevPage: productResult.hasPrevPage,
    limit: productResult.limit,
    page: productResult.page ?? filters.page,
    totalDocs: productResult.totalDocs,
    totalPages: productResult.totalPages,
  }
}

export const listCatalogProducts = async (payload: Payload, filters: CatalogFilters) => {
  if (!hasVariantFilters(filters) && (filters.sort === 'name' || filters.sort === 'newest')) {
    return listPaginatedByDatabase(payload, filters)
  }
  let matchedVariants: ProductVariant[] = []
  let availableInventory: Inventory[] | undefined

  if (hasVariantFilters(filters)) {
    const variantResult = await payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      where: variantWhere(filters),
    })
    matchedVariants = variantResult.docs

    if (filters.available !== undefined) {
      availableInventory = await loadInventory(payload, matchedVariants)
      const availability = inventoryByVariant(availableInventory)
      matchedVariants = matchedVariants.filter(
        (variant) =>
          availableQuantity(availability.get(String(variant.id))) > 0 === filters.available,
      )
    }

    if (matchedVariants.length === 0) {
      return {
        docs: [],
        hasNextPage: false,
        hasPrevPage: filters.page > 1,
        limit: filters.limit,
        page: filters.page,
        totalDocs: 0,
        totalPages: 0,
      }
    }
  }

  const where = productWhere(filters)
  if (hasVariantFilters(filters)) {
    const productIDs = [...new Set(matchedVariants.map(productIDFromVariant).filter(Boolean))]
    ;(where.and as Where[]).push({ id: { in: productIDs } })
  }

  const productResult = await payload.find({
    collection: 'products',
    depth: 2,
    limit: MAX_MATCHED_PRODUCTS,
    overrideAccess: false,
    pagination: false,
    sort: filters.sort === 'name' ? 'name' : '-publishedAt',
    where,
  })
  const products = productResult.docs
  const productIDs = products.map(({ id }) => id)

  if (!hasVariantFilters(filters) && productIDs.length) {
    const variantResult = await payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      where: { and: [{ product: { in: productIDs } }, { status: { equals: 'active' } }] },
    })
    matchedVariants = variantResult.docs
  }

  const inventories = availableInventory ?? (await loadInventory(payload, matchedVariants))
  let docs = buildCatalogDocuments(products, matchedVariants, inventories)
  if (filters.sort === 'price-low') {
    docs = docs.sort(
      (a, b) => (a.priceRange?.minPaise ?? Infinity) - (b.priceRange?.minPaise ?? Infinity),
    )
  } else if (filters.sort === 'price-high') {
    docs = docs.sort((a, b) => (b.priceRange?.minPaise ?? -1) - (a.priceRange?.minPaise ?? -1))
  }

  const totalDocs = docs.length
  const totalPages = Math.ceil(totalDocs / filters.limit)
  const start = (filters.page - 1) * filters.limit

  return {
    docs: docs.slice(start, start + filters.limit),
    hasNextPage: filters.page < totalPages,
    hasPrevPage: filters.page > 1 && totalPages > 0,
    limit: filters.limit,
    page: filters.page,
    totalDocs,
    totalPages,
  }
}

export const getCatalogProduct = async (payload: Payload, identifier: string) => {
  const numericID = Number(identifier)
  const identifierWhere: Where =
    Number.isSafeInteger(numericID) && numericID > 0
      ? { id: { equals: numericID } }
      : { slug: { equals: identifier } }

  const result = await payload.find({
    collection: 'products',
    depth: 2,
    limit: 1,
    overrideAccess: false,
    where: { and: [{ status: { equals: 'active' } }, identifierWhere] },
  })
  const product = result.docs[0]
  if (!product) return null

  const variantsResult = await payload.find({
    collection: 'product-variants',
    depth: 1,
    limit: 100,
    overrideAccess: false,
    pagination: false,
    sort: 'pricePaise',
    where: { and: [{ product: { equals: product.id } }, { status: { equals: 'active' } }] },
  })
  const inventories = await loadInventory(payload, variantsResult.docs)
  return buildCatalogDocuments([product], variantsResult.docs, inventories)[0]
}
