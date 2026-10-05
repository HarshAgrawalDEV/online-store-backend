import type { Payload } from 'payload'

import type { Inventory, Product, ProductVariant } from '../../payload-types'
import { relationshipID } from '../../lib/catalog'
import { indexText } from '../../lib/search-text'
import { productTypeLabels, type ProductType } from '../../lib/set-details'
import { rowsOf, searchDatabase, sql } from './db'

/**
 * The search index is one row per active product in `search_documents`, rebuilt from the
 * catalogue whenever a product, its variants, its stock or a library entry changes.
 * The catalogue stays the source of truth; the index can always be rebuilt from it.
 */

export type SearchDocument = {
  body: string
  department: string
  inStock: boolean
  isFeatured: boolean
  maxPricePaise: number
  minPricePaise: number
  name: string
  nameText: string
  productId: number
  publishedAt: Date | null
  slug: string
  tagsText: string
  textText: string
  skuText: string
}

const BATCH_SIZE = 100

const objects = <T extends object>(values: unknown): T[] =>
  (Array.isArray(values) ? values : []).filter(
    (value): value is T => typeof value === 'object' && value !== null,
  )

const namesOf = (values: unknown): string[] =>
  objects<{ name?: string }>(values).flatMap(({ name }) => (name ? [name] : []))

const availableQuantity = (inventory?: Inventory): number =>
  inventory?.stockStatus === 'available'
    ? Math.max(0, Number(inventory.onHand) - Number(inventory.reserved))
    : 0

/** Everything a customer might type to find this product, grouped by how much it matters. */
export const buildSearchDocument = (
  product: Product,
  variants: ProductVariant[],
  inventoryByVariant: Map<string, Inventory>,
): SearchDocument => {
  const jewellery = product.jewellery
  const productType = product.setDetails?.productType as ProductType | null | undefined
  const material = typeof product.material === 'object' ? product.material : undefined
  const primaryCategory =
    typeof product.primaryCategory === 'object' ? product.primaryCategory : undefined

  const tagsText = indexText(
    primaryCategory?.name,
    namesOf(product.categories),
    material?.name,
    variants.map((variant) => variant.colourLabel),
    variants.map((variant) => variant.sizeLabel),
    productType ? productTypeLabels[productType] : undefined,
    product.department === 'jewellery' ? 'jewellery jewelry' : 'bangles',
    namesOf(jewellery?.components?.map((entry) => entry.piece)),
    namesOf(jewellery?.styles),
    namesOf(jewellery?.stoneTypes),
    namesOf([jewellery?.finish]),
    jewellery?.baseMetal,
  )
  const textText = indexText(
    product.shortDescription,
    namesOf(product.occasions),
    namesOf(product.collections),
    product.specifications?.map((specification) => specification.value),
    product.styleTags?.map((tag) => tag.label),
  )
  const skuText = indexText(variants.map((variant) => variant.sku))
  const nameText = indexText(product.name)
  const prices = variants.map(({ pricePaise }) => pricePaise)

  return {
    body: [nameText, tagsText, textText, skuText].filter(Boolean).join(' '),
    department: product.department,
    inStock: variants.some(
      (variant) => availableQuantity(inventoryByVariant.get(String(variant.id))) > 0,
    ),
    isFeatured: Boolean(product.isFeatured),
    maxPricePaise: prices.length ? Math.max(...prices) : 0,
    minPricePaise: prices.length ? Math.min(...prices) : 0,
    name: product.name,
    nameText,
    productId: product.id,
    publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
    skuText,
    slug: product.slug,
    tagsText,
    textText,
  }
}

const upsertDocuments = async (payload: Payload, documents: SearchDocument[]): Promise<void> => {
  if (!documents.length) return
  const rows = documents.map(
    (doc) => sql`(
      ${doc.productId}, ${doc.name}, ${doc.slug}, ${doc.department}, ${doc.body},
      setweight(to_tsvector('simple', ${doc.nameText}), 'A') ||
        setweight(to_tsvector('simple', ${doc.tagsText}), 'B') ||
        setweight(to_tsvector('simple', ${doc.textText}), 'C') ||
        setweight(to_tsvector('simple', ${doc.skuText}), 'D'),
      ${doc.minPricePaise}, ${doc.maxPricePaise}, ${doc.inStock}, ${doc.isFeatured},
      ${doc.publishedAt}, now()
    )`,
  )
  await searchDatabase(payload).execute(sql`
    INSERT INTO search_documents (
      product_id, name, slug, department, body, tsv,
      min_price_paise, max_price_paise, in_stock, is_featured, published_at, updated_at
    ) VALUES ${sql.join(rows, sql`, `)}
    ON CONFLICT (product_id) DO UPDATE SET
      name = EXCLUDED.name, slug = EXCLUDED.slug, department = EXCLUDED.department,
      body = EXCLUDED.body, tsv = EXCLUDED.tsv,
      min_price_paise = EXCLUDED.min_price_paise, max_price_paise = EXCLUDED.max_price_paise,
      in_stock = EXCLUDED.in_stock, is_featured = EXCLUDED.is_featured,
      published_at = EXCLUDED.published_at, updated_at = now()
  `)
}

const deleteDocuments = async (payload: Payload, productIds: number[]): Promise<void> => {
  if (!productIds.length) return
  await searchDatabase(payload).execute(
    sql`DELETE FROM search_documents WHERE product_id IN (${sql.join(
      productIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  )
}

/** Rebuild the rows for these products: active ones are written, everything else is removed. */
export const reindexProducts = async (payload: Payload, productIds: number[]): Promise<number> => {
  const ids = [...new Set(productIds)]
  let indexed = 0
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const chunk = ids.slice(start, start + BATCH_SIZE)
    const products = await payload.find({
      collection: 'products',
      depth: 2,
      limit: chunk.length,
      overrideAccess: true,
      pagination: false,
      where: { and: [{ id: { in: chunk } }, { status: { equals: 'active' } }] },
    })
    const variants = products.docs.length
      ? (
          await payload.find({
            collection: 'product-variants',
            depth: 0,
            limit: 5000,
            overrideAccess: true,
            pagination: false,
            where: {
              and: [
                { product: { in: products.docs.map(({ id }) => id) } },
                { status: { equals: 'active' } },
              ],
            },
          })
        ).docs
      : []
    const inventories = variants.length
      ? (
          await payload.find({
            collection: 'inventory',
            depth: 0,
            limit: variants.length,
            overrideAccess: true,
            pagination: false,
            where: { variant: { in: variants.map(({ id }) => id) } },
          })
        ).docs
      : []
    const inventoryByVariant = new Map(
      inventories.map((record) => [String(relationshipID(record.variant)), record]),
    )
    const variantsByProduct = new Map<number, ProductVariant[]>()
    for (const variant of variants) {
      const productId = Number(relationshipID(variant.product))
      variantsByProduct.set(productId, [...(variantsByProduct.get(productId) ?? []), variant])
    }

    const documents = products.docs.map((product) =>
      buildSearchDocument(product, variantsByProduct.get(product.id) ?? [], inventoryByVariant),
    )
    await upsertDocuments(payload, documents)
    const activeIds = new Set(products.docs.map(({ id }) => id))
    await deleteDocuments(
      payload,
      chunk.filter((id) => !activeIds.has(id)),
    )
    indexed += documents.length
  }
  return indexed
}

/** Rebuild the whole index and drop rows for products that are gone or no longer active. */
export const reindexAll = async (
  payload: Payload,
): Promise<{ indexed: number; removed: number }> => {
  const ids: number[] = []
  let page = 1
  for (;;) {
    const result = await payload.find({
      collection: 'products',
      depth: 0,
      limit: 500,
      overrideAccess: true,
      page,
      select: {},
      where: { status: { equals: 'active' } },
    })
    ids.push(...result.docs.map(({ id }) => id))
    if (!result.hasNextPage) break
    page += 1
  }
  const indexed = await reindexProducts(payload, ids)
  const stale = await rowsOf<{ product_id: number }>(
    payload,
    ids.length
      ? sql`SELECT product_id FROM search_documents WHERE product_id NOT IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`SELECT product_id FROM search_documents`,
  )
  await deleteDocuments(
    payload,
    stale.map((row) => Number(row.product_id)),
  )
  return { indexed, removed: stale.length }
}

/* ------------------------------------------------------------------ keeping it current */

const FLUSH_DELAY_MS = 750
const FULL_REINDEX_DELAY_MS = 5_000

type Pending = {
  fullTimer?: ReturnType<typeof setTimeout>
  productIds: Set<number>
  timer?: ReturnType<typeof setTimeout>
  variantIds: Set<number>
}

const PENDING = Symbol.for('jewelry.search.pending')
const pendingState = (): Pending => {
  const globals = globalThis as unknown as Record<symbol, Pending>
  globals[PENDING] ??= { productIds: new Set(), variantIds: new Set() }
  return globals[PENDING]
}

const flush = async (payload: Payload): Promise<void> => {
  const state = pendingState()
  const productIds = [...state.productIds]
  const variantIds = [...state.variantIds]
  state.productIds.clear()
  state.variantIds.clear()
  state.timer = undefined
  try {
    if (variantIds.length) {
      const variants = await payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: variantIds.length,
        overrideAccess: true,
        pagination: false,
        select: { product: true },
        where: { id: { in: variantIds } },
      })
      for (const variant of variants.docs) {
        const productId = Number(relationshipID(variant.product))
        if (Number.isFinite(productId)) productIds.push(productId)
      }
    }
    await reindexProducts(payload, productIds)
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Search index update failed' })
  }
}

/**
 * Queue products (or variants) for re-indexing. Runs shortly afterwards, outside the request
 * and outside any open transaction, so it reads committed data and can never fail a save.
 */
export const scheduleSearchReindex = (
  payload: Payload,
  change: {
    productIds?: Array<null | number | string | undefined>
    variantIds?: Array<null | number | string | undefined>
  },
): void => {
  const state = pendingState()
  const keep = (value: null | number | string | undefined) =>
    value === null || value === undefined ? undefined : Number(value)
  for (const id of change.productIds ?? []) {
    const value = keep(id)
    if (value !== undefined && Number.isFinite(value)) state.productIds.add(value)
  }
  for (const id of change.variantIds ?? []) {
    const value = keep(id)
    if (value !== undefined && Number.isFinite(value)) state.variantIds.add(value)
  }
  if (state.timer) return
  state.timer = setTimeout(() => void flush(payload), FLUSH_DELAY_MS)
  state.timer.unref?.()
}

/** A library entry (colour, material, category...) changed: names inside many products moved. */
export const scheduleFullSearchReindex = (payload: Payload): void => {
  const state = pendingState()
  if (state.fullTimer) clearTimeout(state.fullTimer)
  state.fullTimer = setTimeout(() => {
    state.fullTimer = undefined
    reindexAll(payload).catch((error) =>
      payload.logger.error({ err: error, msg: 'Full search reindex failed' }),
    )
  }, FULL_REINDEX_DELAY_MS)
  state.fullTimer.unref?.()
}

/** On start-up: build the index if it is missing or out of step with the catalogue. */
export const ensureSearchIndex = async (payload: Payload): Promise<void> => {
  try {
    const [{ count: indexed }] = await rowsOf<{ count: number }>(
      payload,
      sql`SELECT count(*)::int AS count FROM search_documents`,
    )
    const active = await payload.count({
      collection: 'products',
      overrideAccess: true,
      where: { status: { equals: 'active' } },
    })
    if (Number(indexed) !== active.totalDocs) {
      const result = await reindexAll(payload)
      payload.logger.info({ ...result, msg: 'Search index rebuilt' })
    }
    // Keep the search log to the last 90 days.
    await payload.delete({
      collection: 'search-queries',
      overrideAccess: true,
      where: {
        createdAt: { less_than: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
      },
    })
  } catch (error) {
    payload.logger.warn({
      err: error,
      msg: 'Search index is not available yet. Run `pnpm migrate`; catalogue search uses the basic fallback until then.',
    })
  }
}
