import type {
  Colour,
  Inventory,
  Material,
  Occasion,
  Product,
  ProductVariant,
  Size,
} from '../payload-types'
import type { Payload, Where } from 'payload'

import { relationshipID } from '../lib/catalog'
import {
  departments,
  describeComponents,
  type Department,
  type JewelleryComponent,
} from '../lib/jewellery'
import { resolveSetDetails, type SetDetails } from '../lib/set-details'
import { searchProducts } from './search/query'

const MAX_PAGE_SIZE = 50
const MAX_MATCHED_PRODUCTS = 500
const UNSORTED = 9999

export class CatalogQueryError extends Error {}

export type CatalogFilters = {
  available?: boolean
  category?: number
  collection?: number
  /** Bangles or jewellery. */
  department?: Department
  /** Finish slug, for example antique-gold-look. */
  finish?: string[]
  /** Piece-type slug: only products that contain this part (earrings, nath...). */
  piece?: string[]
  /** Jewellery style slug, for example kundan-look. */
  style?: string[]
  /** Stone-type slug, for example ad-cz. */
  stone?: string[]
  /** Colour code from the colour library, for example rani or chiku. */
  color?: string[]
  limit: number
  /** Material slug, for example boor. */
  material?: string[]
  maxPrice?: number
  minPrice?: number
  /** Occasion slug, for example diwali. */
  occasion?: string[]
  page: number
  search?: string
  /** Size code, for example 2-4. */
  size?: string[]
  /** `relevance` is the best match for the search words; without a search it means newest. */
  sort: 'name' | 'newest' | 'price-high' | 'price-low' | 'relevance'
}

/** "rani,maroon" or repeated keys both become a list; empty gives undefined. */
const listParam = (params: URLSearchParams, ...keys: string[]): string[] | undefined => {
  const values = keys
    .flatMap((key) => params.getAll(key))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  return values.length ? [...new Set(values)].slice(0, 20) : undefined
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

  const sort = params.get('sort') ?? (params.get('search')?.trim() ? 'relevance' : 'newest')
  if (!['name', 'newest', 'price-high', 'price-low', 'relevance'].includes(sort)) {
    throw new CatalogQueryError('sort must be relevance, name, newest, price-low, or price-high.')
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

  const department = params.get('department')?.trim().toLowerCase()
  if (department && !(departments as readonly string[]).includes(department)) {
    throw new CatalogQueryError('department must be bangles or jewellery.')
  }
  const lower = (...keys: string[]) =>
    listParam(params, ...keys)?.map((value) => value.toLowerCase())

  return {
    available: available === null ? undefined : available === 'true',
    category: optionalInteger(params, 'category', 1),
    collection: optionalInteger(params, 'collection', 1),
    department: department as Department | undefined,
    finish: lower('finish'),
    piece: lower('piece'),
    style: lower('style'),
    stone: lower('stone'),
    color: listParam(params, 'colour', 'color')?.map((value) => value.toLowerCase()),
    limit,
    material: listParam(params, 'material')?.map((value) => value.toLowerCase()),
    maxPrice,
    minPrice,
    occasion: listParam(params, 'occasion')?.map((value) => value.toLowerCase()),
    page,
    search: params.get('search')?.trim() || undefined,
    size: listParam(params, 'size'),
    sort: sort as CatalogFilters['sort'],
  }
}

const availableQuantity = (inventory?: Inventory): number =>
  inventory?.stockStatus === 'available'
    ? Math.max(0, Number(inventory.onHand) - Number(inventory.reserved))
    : 0

/* ------------------------------------------------------------------ libraries */

type Libraries = {
  colours: Map<string, Colour>
  sizes: Map<string, Size>
}

const loadLibraries = async (payload: Payload, variants: ProductVariant[]): Promise<Libraries> => {
  const unique = (values: Array<null | number | string | undefined>) => [
    ...new Set(values.filter((value): value is number | string => value != null).map(String)),
  ]
  const sizeIDs = unique(variants.map((variant) => relationshipID(variant.size)))
  const colourIDs = unique(variants.map((variant) => relationshipID(variant.colour)))
  const [sizes, colours] = await Promise.all([
    sizeIDs.length
      ? payload.find({
          collection: 'sizes',
          depth: 0,
          limit: sizeIDs.length,
          overrideAccess: true,
          pagination: false,
          where: { id: { in: sizeIDs } },
        })
      : { docs: [] as Size[] },
    colourIDs.length
      ? payload.find({
          collection: 'colours',
          depth: 0,
          limit: colourIDs.length,
          overrideAccess: true,
          pagination: false,
          where: { id: { in: colourIDs } },
        })
      : { docs: [] as Colour[] },
  ])
  return {
    colours: new Map(colours.docs.map((colour) => [String(colour.id), colour])),
    sizes: new Map(sizes.docs.map((size) => [String(size.id), size])),
  }
}

const publicSize = (size: Size) => ({
  code: size.code,
  id: size.id,
  innerDiameterMm: size.innerDiameterMm ?? null,
  label: size.label,
  sortOrder: Number(size.sortOrder ?? 0),
})

const publicColour = (colour: Colour) => ({
  code: colour.code,
  id: colour.id,
  name: colour.name,
  note: colour.note ?? null,
  sortOrder: Number(colour.sortOrder ?? 0),
  swatchHex: colour.swatchHex ?? null,
})

/* ------------------------------------------------------------------ response shaping */

const publicVariant = (
  variant: ProductVariant,
  inventory: Inventory | undefined,
  libs: Libraries,
) => {
  const {
    costPaise: _costPaise,
    customColourName: _customColourName,
    saveToColourLibrary: _saveToColourLibrary,
    ...safeVariant
  } = variant
  const size = libs.sizes.get(String(relationshipID(variant.size)))
  const colour = libs.colours.get(String(relationshipID(variant.colour)))
  return {
    ...safeVariant,
    availability: {
      available: availableQuantity(inventory) > 0,
      quantity: availableQuantity(inventory),
    },
    // Library colour when there is one; a one-off colour shows its typed name only.
    colour: colour
      ? publicColour(colour)
      : variant.colourLabel
        ? { code: variant.colorCode ?? null, name: variant.colourLabel }
        : null,
    size: size
      ? publicSize(size)
      : variant.sizeLabel
        ? { code: variant.sizeCode ?? null, label: variant.sizeLabel }
        : null,
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

const publicMaterial = (value: Product['material']) =>
  value && typeof value === 'object'
    ? {
        code: (value as Material).code,
        description: (value as Material).description ?? null,
        id: (value as Material).id,
        isPremium: (value as Material).isPremium,
        name: (value as Material).name,
        slug: (value as Material).slug,
      }
    : null

const publicOccasions = (values: Product['occasions']) =>
  (values ?? [])
    .filter((value): value is Occasion => typeof value === 'object' && value !== null)
    .map((occasion) => ({ id: occasion.id, name: occasion.name, slug: occasion.slug }))

type Named = { id: number; name: string; slug: string }

const named = (values: unknown): Named[] =>
  (Array.isArray(values) ? values : [])
    .filter((value): value is Named => typeof value === 'object' && value !== null)
    .map(({ id, name, slug }) => ({ id, name, slug }))

/** What a jewellery product contains and how it looks. Null for bangles. */
const publicJewellery = (product: Product) => {
  if (product.department !== 'jewellery') return null
  const group = product.jewellery ?? {}
  const components = (group.components ?? []).flatMap((entry) => {
    const piece = entry.piece
    if (!piece || typeof piece !== 'object') return []
    return [
      {
        id: piece.id,
        name: piece.name,
        quantity: Number(entry.quantity ?? 1),
        slug: piece.slug,
        soldAsPair: Boolean(piece.soldAsPair),
      },
    ]
  })
  const finish = named([group.finish])[0] ?? null
  return {
    baseMetal: group.baseMetal ?? null,
    components,
    finish,
    fit: group.fit ?? null,
    isSet: components.length > 1,
    stoneTypes: named(group.stoneTypes),
    styles: named(group.styles),
    summary: describeComponents(components as JewelleryComponent[]),
    wear: group.wear ?? null,
  }
}

const buildCatalogDocuments = (
  products: Product[],
  variants: ProductVariant[],
  inventories: Inventory[],
  libs: Libraries,
) => {
  const groupedVariants = variantsByProduct(variants)
  const inventoryMap = inventoryByVariant(inventories)

  return products.map((product) => {
    const productVariants = groupedVariants.get(String(product.id)) ?? []
    const prices = productVariants.map(({ pricePaise }) => pricePaise)
    const safeVariants = productVariants
      .map((variant) => publicVariant(variant, inventoryMap.get(String(variant.id)), libs))
      .sort(
        (a, b) =>
          (a.size && 'sortOrder' in a.size ? a.size.sortOrder : UNSORTED) -
            (b.size && 'sortOrder' in b.size ? b.size.sortOrder : UNSORTED) ||
          (a.colour && 'sortOrder' in a.colour ? a.colour.sortOrder : UNSORTED) -
            (b.colour && 'sortOrder' in b.colour ? b.colour.sortOrder : UNSORTED) ||
          a.pricePaise - b.pricePaise,
      )

    // One entry per distinct colour and size, in display order, so the app can draw swatches.
    const colours = new Map<string, Record<string, unknown>>()
    const sizes = new Map<string, Record<string, unknown>>()
    for (const variant of safeVariants) {
      const colourKey = variant.colour?.code ? String(variant.colour.code) : undefined
      if (colourKey && !colours.has(colourKey)) colours.set(colourKey, variant.colour as never)
      const sizeKey = variant.size?.code ? String(variant.size.code) : undefined
      if (sizeKey && !sizes.has(sizeKey)) sizes.set(sizeKey, variant.size as never)
    }

    const { aiDraft: _aiDraft, jewellery: _jewellery, ...publicProduct } = product
    const material = publicMaterial(product.material)
    return {
      ...publicProduct,
      available: safeVariants.some((variant) => variant.availability.available),
      colours: [...colours.values()],
      jewellery: publicJewellery(product),
      // Kept for older app builds that read the material from the details block.
      jewelryDetails: { material: material?.name ?? null },
      material,
      occasions: publicOccasions(product.occasions),
      priceRange: prices.length
        ? { minPaise: Math.min(...prices), maxPaise: Math.max(...prices) }
        : null,
      setDetails: resolveSetDetails((product.setDetails ?? {}) as SetDetails),
      sizes: [...sizes.values()],
      variants: safeVariants,
    }
  })
}

/* ------------------------------------------------------------------ queries */

type LibraryCollection =
  'finishes' | 'jewellery-styles' | 'materials' | 'occasions' | 'piece-types' | 'stone-types'

/** Slugs in the URL become library ids. Unknown slugs are ignored; no match at all gives an empty list. */
const resolveLibraryFilters = async (payload: Payload, filters: CatalogFilters) => {
  const lookup = async (collection: LibraryCollection, slugs?: string[]) => {
    if (!slugs) return undefined
    const found = await payload.find({
      collection,
      depth: 0,
      limit: slugs.length,
      overrideAccess: false,
      pagination: false,
      where: { slug: { in: slugs } },
    })
    return found.docs.map((doc) => doc.id)
  }
  return {
    finishIds: await lookup('finishes', filters.finish),
    materialIds: await lookup('materials', filters.material),
    occasionIds: await lookup('occasions', filters.occasion),
    pieceIds: await lookup('piece-types', filters.piece),
    stoneIds: await lookup('stone-types', filters.stone),
    styleIds: await lookup('jewellery-styles', filters.style),
  }
}

type LibraryIDs = Awaited<ReturnType<typeof resolveLibraryFilters>>

/**
 * Every word typed must match something about the product: its name, note, category, material,
 * a colour or item code of its variants, or an occasion. "rani chuda" finds a rani chuda.
 */
const searchClauses = async (payload: Payload, search: string): Promise<Where[]> => {
  const words = [...new Set(search.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 5)
  return Promise.all(
    words.map(async (word): Promise<Where> => {
      const [variants, occasions, pieces, styles] = await Promise.all([
        payload.find({
          collection: 'product-variants',
          depth: 0,
          limit: 200,
          overrideAccess: false,
          pagination: false,
          select: { product: true },
          where: {
            and: [
              { status: { equals: 'active' } },
              { or: [{ colourLabel: { contains: word } }, { sku: { contains: word } }] },
            ],
          },
        }),
        payload.find({
          collection: 'occasions',
          depth: 0,
          limit: 20,
          overrideAccess: false,
          pagination: false,
          select: { name: true },
          where: { name: { contains: word } },
        }),
        payload.find({
          collection: 'piece-types',
          depth: 0,
          limit: 20,
          overrideAccess: false,
          pagination: false,
          select: { name: true },
          where: { name: { contains: word } },
        }),
        payload.find({
          collection: 'jewellery-styles',
          depth: 0,
          limit: 20,
          overrideAccess: false,
          pagination: false,
          select: { name: true },
          where: { name: { contains: word } },
        }),
      ])
      const productIds = [
        ...new Set(variants.docs.map((variant) => relationshipID(variant.product)).filter(Boolean)),
      ] as number[]
      return {
        or: [
          { name: { contains: word } },
          { shortDescription: { contains: word } },
          { 'material.name': { contains: word } },
          { 'primaryCategory.name': { contains: word } },
          ...(productIds.length ? [{ id: { in: productIds } }] : []),
          ...(occasions.docs.length
            ? [{ occasions: { in: occasions.docs.map((o) => o.id) } }]
            : []),
          ...(pieces.docs.length
            ? [{ 'jewellery.components.piece': { in: pieces.docs.map((o) => o.id) } }]
            : []),
          ...(styles.docs.length
            ? [{ 'jewellery.styles': { in: styles.docs.map((o) => o.id) } }]
            : []),
        ],
      }
    }),
  )
}

const productWhere = (filters: CatalogFilters, ids: LibraryIDs, searchClauses?: Where[]): Where => {
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
  if (filters.department) and.push({ department: { equals: filters.department } })
  if (ids.finishIds) and.push({ 'jewellery.finish': { in: ids.finishIds } })
  if (ids.styleIds) and.push({ 'jewellery.styles': { in: ids.styleIds } })
  if (ids.stoneIds) and.push({ 'jewellery.stoneTypes': { in: ids.stoneIds } })
  if (ids.pieceIds) and.push({ 'jewellery.components.piece': { in: ids.pieceIds } })
  if (ids.materialIds) and.push({ material: { in: ids.materialIds } })
  if (ids.occasionIds) and.push({ occasions: { in: ids.occasionIds } })
  if (searchClauses) and.push(...searchClauses)
  return { and }
}

const variantWhere = (filters: CatalogFilters): Where => {
  const and: Where[] = [{ status: { equals: 'active' } }]
  if (filters.color) and.push({ colorCode: { in: filters.color } })
  if (filters.size) and.push({ sizeCode: { in: filters.size } })
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

const emptyPage = (filters: CatalogFilters) => ({
  docs: [],
  hasNextPage: false,
  hasPrevPage: filters.page > 1,
  limit: filters.limit,
  page: filters.page,
  totalDocs: 0,
  totalPages: 0,
})

const withVariantData = async (
  payload: Payload,
  products: Product[],
  variants: ProductVariant[],
) => {
  const [inventories, libs] = await Promise.all([
    loadInventory(payload, variants),
    loadLibraries(payload, variants),
  ])
  return buildCatalogDocuments(products, variants, inventories, libs)
}

/**
 * Fast path for the common listing (no variant filters, name/newest order): the database
 * paginates products and only the current page of variants and stock is loaded. Price sorting
 * and variant filters still need every candidate's variants, so they use the bounded path below.
 */
const listPaginatedByDatabase = async (payload: Payload, filters: CatalogFilters, where: Where) => {
  const productResult = await payload.find({
    collection: 'products',
    depth: 2,
    limit: filters.limit,
    overrideAccess: false,
    page: filters.page,
    sort: filters.sort === 'name' ? 'name' : '-publishedAt',
    where,
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
  return {
    docs: await withVariantData(payload, productResult.docs, variants),
    hasNextPage: productResult.hasNextPage,
    hasPrevPage: productResult.hasPrevPage,
    limit: productResult.limit,
    page: productResult.page ?? filters.page,
    totalDocs: productResult.totalDocs,
    totalPages: productResult.totalPages,
  }
}

/**
 * Everything after the text search: filters, variants, stock, sorting and paging.
 * `ranked` is the search's product ids, best match first, when a search was made.
 */
const listMatchingProducts = async (
  payload: Payload,
  filters: CatalogFilters,
  where: Where,
  ranked?: number[],
) => {
  const sort = filters.sort === 'relevance' && !ranked ? 'newest' : filters.sort
  if (!hasVariantFilters(filters) && (sort === 'name' || sort === 'newest')) {
    return listPaginatedByDatabase(payload, filters, where)
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

    if (matchedVariants.length === 0) return emptyPage(filters)
  }

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

  const [inventories, libs] = await Promise.all([
    availableInventory ?? loadInventory(payload, matchedVariants),
    loadLibraries(payload, matchedVariants),
  ])
  let docs = buildCatalogDocuments(products, matchedVariants, inventories, libs)
  if (sort === 'relevance' && ranked) {
    const order = new Map(ranked.map((id, position) => [id, position]))
    docs = docs.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
  } else if (sort === 'price-low') {
    docs = docs.sort(
      (a, b) => (a.priceRange?.minPaise ?? Infinity) - (b.priceRange?.minPaise ?? Infinity),
    )
  } else if (sort === 'price-high') {
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

export const listCatalogProducts = async (payload: Payload, filters: CatalogFilters) => {
  const ids = await resolveLibraryFilters(payload, filters)
  if (Object.values(ids).some((list) => list?.length === 0)) return emptyPage(filters)

  // Text search uses the search index; if it is unavailable the older word-by-word search runs.
  let ranked: number[] | undefined
  let relaxed = false
  if (filters.search) {
    try {
      const found = await searchProducts(payload, filters.search)
      ranked = found.ids
      relaxed = found.relaxed
    } catch (error) {
      payload.logger.warn({ err: error, msg: 'Search index query failed; using the basic search' })
    }
  }

  const where = productWhere(
    filters,
    ids,
    filters.search && !ranked ? await searchClauses(payload, filters.search) : undefined,
  )
  if (ranked) {
    if (ranked.length === 0) return { ...emptyPage(filters), search: { relaxed: false } }
    ;(where.and as Where[]).push({ id: { in: ranked } })
  }

  const page = await listMatchingProducts(payload, filters, where, ranked)
  return filters.search ? { ...page, search: { relaxed } } : page
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
  return (await withVariantData(payload, [product], variantsResult.docs))[0]
}

const libraryFacet = async (
  payload: Payload,
  collection: 'finishes' | 'jewellery-styles' | 'piece-types' | 'stone-types',
  ids: Set<number>,
) => {
  if (ids.size === 0) return []
  const found = await payload.find({
    collection,
    depth: 0,
    limit: ids.size,
    overrideAccess: false,
    pagination: false,
    sort: 'sortOrder',
    where: { id: { in: [...ids] } },
  })
  return found.docs.map(({ id, name, slug }) => ({ id, name, slug }))
}

/**
 * Everything the filter screen needs: departments with their categories, and the materials, colours,
 * sizes, occasions and jewellery styles, stones, finishes and parts that active products actually use.
 * Pass a department to get only the choices that make sense there.
 */
export const getCatalogFacets = async (payload: Payload, department?: Department) => {
  const productScope: Where = {
    and: [
      { status: { equals: 'active' } },
      ...(department ? [{ department: { equals: department } }] : []),
    ],
  }
  const [categories, materials, occasions, scopedProducts] = await Promise.all([
    payload.find({
      collection: 'categories',
      depth: 0,
      limit: 200,
      overrideAccess: false,
      pagination: false,
      sort: 'sortOrder',
      ...(department ? { where: { department: { equals: department } } } : {}),
    }),
    department === 'jewellery'
      ? { docs: [] as Material[] }
      : payload.find({
          collection: 'materials',
          depth: 0,
          limit: 100,
          overrideAccess: false,
          pagination: false,
          sort: 'sortOrder',
        }),
    payload.find({
      collection: 'occasions',
      depth: 0,
      limit: 100,
      overrideAccess: false,
      pagination: false,
      sort: 'sortOrder',
    }),
    payload.find({
      collection: 'products',
      depth: 0,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      select: { department: true, jewellery: true },
      where: productScope,
    }),
  ])
  const productIDs = scopedProducts.docs.map(({ id }) => id)
  const variants = productIDs.length
    ? await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: 1000,
        overrideAccess: false,
        pagination: false,
        where: { and: [{ status: { equals: 'active' } }, { product: { in: productIDs } }] },
      })
    : { docs: [] as ProductVariant[] }

  // Parts, styles, stones and finishes in use by the jewellery in scope.
  const used = {
    finishes: new Set<number>(),
    pieces: new Set<number>(),
    stones: new Set<number>(),
    styles: new Set<number>(),
  }
  const idOf = (value: unknown) => relationshipID(value) as number | undefined
  for (const product of scopedProducts.docs) {
    const group = product.jewellery
    if (!group) continue
    const finish = idOf(group.finish)
    if (finish) used.finishes.add(finish)
    for (const style of group.styles ?? []) used.styles.add(idOf(style) as number)
    for (const stone of group.stoneTypes ?? []) used.stones.add(idOf(stone) as number)
    for (const entry of group.components ?? []) {
      const piece = idOf(entry.piece)
      if (piece) used.pieces.add(piece)
    }
  }
  const [finishes, jewelleryStyles, stoneTypes, pieceTypes] = await Promise.all([
    libraryFacet(payload, 'finishes', used.finishes),
    libraryFacet(payload, 'jewellery-styles', used.styles),
    libraryFacet(payload, 'stone-types', used.stones),
    libraryFacet(payload, 'piece-types', used.pieces),
  ])

  // Only library colours and sizes that active products actually use; one-off colours are not offered as filters.
  const libs = await loadLibraries(payload, variants.docs)
  const prices = variants.docs.map(({ pricePaise }) => pricePaise)
  return {
    categories: categories.docs.map((category) => ({
      department: category.department,
      id: category.id,
      name: category.name,
      parent: relationshipID(category.parent) ?? null,
      slug: category.slug,
    })),
    colours: [...libs.colours.values()]
      .filter((colour) => colour.isActive)
      .map(publicColour)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    departments: departments.map((slug) => ({
      name: slug === 'bangles' ? 'Bangles' : 'Jewellery',
      slug,
    })),
    finishes,
    jewelleryStyles,
    materials: materials.docs.map((material) => ({
      code: material.code,
      id: material.id,
      isPremium: material.isPremium,
      name: material.name,
      slug: material.slug,
    })),
    occasions: occasions.docs.map((occasion) => ({
      id: occasion.id,
      name: occasion.name,
      slug: occasion.slug,
    })),
    pieceTypes,
    priceRange: prices.length
      ? { maxPaise: Math.max(...prices), minPaise: Math.min(...prices) }
      : null,
    sizes: [...libs.sizes.values()]
      .filter((size) => size.isActive)
      .map(publicSize)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    stoneTypes,
  }
}
