import type { PayloadRequest } from 'payload'

import { MobileAPIError } from '../lib/api-response'
import { normalizeCode } from '../lib/catalog'
import { sizeNotAllowedMessage } from '../lib/set-details'

const MAX_COMBINATIONS = 120
const MAX_PRICE_PAISE = 100_000_000

export type GenerateVariantsInput = {
  /** Library colour codes. */
  colours: string[]
  compareAtPricePaise?: number
  /** Opening stock for every new variant that has no entry in `stock`. */
  defaultStock?: number
  /** One-off colour names that are not in the library; created only when saveToLibrary is true. */
  customColours: string[]
  maxPerOrder: number
  price?: number
  priceBySize?: Record<string, number>
  saveToLibrary: boolean
  /** Opening stock per variant, keyed "sizeCode|colourCode". */
  stock?: Record<string, number>
  /** Size codes from the size library. */
  sizes: string[]
  status: 'active' | 'inactive'
}

const fail = (message: string): never => {
  throw new MobileAPIError('INVALID_VARIANT_REQUEST', message, 400)
}

const stringList = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return fail(`${field} must be a list of text values.`)
  }
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))]
}

const stockCount = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000) {
    return fail(`${field} must be a whole number from 0 to 100000.`)
  }
  return value as number
}

const pricePaise = (value: unknown, field: string): number => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_PRICE_PAISE
  ) {
    return fail(`${field} must be a whole number of paise greater than zero.`)
  }
  return value as number
}

export const parseGenerateVariants = (value: unknown): GenerateVariantsInput => {
  if (!value || typeof value !== 'object') return fail('A JSON body is required.')
  const body = value as Record<string, unknown>
  const sizes = stringList(body.sizes, 'sizes')
  const colours = stringList(body.colours, 'colours').map((code) => code.toLowerCase())
  const customColours = stringList(body.customColours, 'customColours')
  if (colours.length + customColours.length === 0) fail('Choose at least one colour.')

  let priceBySize: Record<string, number> | undefined
  if (body.priceBySize !== undefined) {
    if (typeof body.priceBySize !== 'object' || body.priceBySize === null) {
      fail('priceBySize must be an object of size code to price in paise.')
    }
    priceBySize = {}
    for (const [code, price] of Object.entries(body.priceBySize as Record<string, unknown>)) {
      priceBySize[code] = pricePaise(price, `priceBySize.${code}`)
    }
  }
  const price = body.price === undefined ? undefined : pricePaise(body.price, 'price')
  if (price === undefined && !priceBySize) fail('Give a price or a price for each size.')
  if (sizes.length === 0 && price === undefined) fail('Give a price.')
  if (!price && priceBySize) {
    const missing = sizes.filter((code) => priceBySize?.[code] === undefined)
    if (missing.length) fail(`Missing a price for size ${missing.join(', ')}.`)
  }

  let stock: Record<string, number> | undefined
  if (body.stock !== undefined) {
    if (typeof body.stock !== 'object' || body.stock === null || Array.isArray(body.stock)) {
      fail('stock must be an object of "size|colour" to quantity.')
    }
    stock = {}
    for (const [key, quantity] of Object.entries(body.stock as Record<string, unknown>)) {
      stock[key] = stockCount(quantity, `stock.${key}`)
    }
  }
  const defaultStock =
    body.defaultStock === undefined ? undefined : stockCount(body.defaultStock, 'defaultStock')

  const rawStatus = body.status === undefined ? 'active' : body.status
  if (rawStatus !== 'active' && rawStatus !== 'inactive') fail('status must be active or inactive.')
  const status = rawStatus as 'active' | 'inactive'
  const maxPerOrder = body.maxPerOrder === undefined ? 5 : Number(body.maxPerOrder)
  if (!Number.isSafeInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 100) {
    fail('maxPerOrder must be a whole number from 1 to 100.')
  }
  const compareAt =
    body.compareAtPricePaise === undefined
      ? undefined
      : pricePaise(body.compareAtPricePaise, 'compareAtPricePaise')

  if (sizes.length * (colours.length + customColours.length) > MAX_COMBINATIONS) {
    fail(`Choose at most ${MAX_COMBINATIONS} size and colour combinations at a time.`)
  }

  return {
    colours,
    compareAtPricePaise: compareAt,
    customColours,
    maxPerOrder,
    price,
    priceBySize,
    defaultStock,
    saveToLibrary: body.saveToLibrary === true,
    stock,
    sizes,
    status,
  }
}

type Combination = {
  colour?: { code: string; id: number }
  customName?: string
  /** Absent for jewellery that comes in one size. */
  size?: { code: string; id: number }
}

/**
 * Creates one variant (with an inventory row (zero stock unless opening stock is given)) for every size and colour that does not
 * exist yet. Running it again with the same choices creates nothing, so a half-finished run can
 * simply be repeated.
 */
export const generateVariants = async (
  req: PayloadRequest,
  productID: number,
  input: GenerateVariantsInput,
) => {
  const { payload } = req
  const products = await payload.find({
    collection: 'products',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { id: { equals: productID } },
  })
  if (!products.docs[0]) throw new MobileAPIError('PRODUCT_NOT_FOUND', 'Product not found.', 404)
  // Bangles always come in sizes. Jewellery usually does not: one variant per colour.
  if (input.sizes.length === 0 && products.docs[0].department !== 'jewellery') {
    fail('Choose at least one size.')
  }

  const sizeDocs = await payload.find({
    collection: 'sizes',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    req,
    where: { code: { in: input.sizes } },
  })
  const sizes = new Map(sizeDocs.docs.filter((doc) => doc.isActive).map((doc) => [doc.code, doc]))
  const missingSizes = input.sizes.filter((code) => !sizes.has(code))
  if (missingSizes.length) fail(`Unknown or inactive size: ${missingSizes.join(', ')}.`)

  const colourDocs = input.colours.length
    ? await payload.find({
        collection: 'colours',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        pagination: false,
        req,
        where: { code: { in: input.colours } },
      })
    : { docs: [] }
  const colours = new Map(
    colourDocs.docs.filter((doc) => doc.isActive).map((doc) => [doc.code, doc]),
  )
  const missingColours = input.colours.filter((code) => !colours.has(code))
  if (missingColours.length) fail(`Unknown or inactive colour: ${missingColours.join(', ')}.`)

  const combinations: Combination[] = []
  const sizeChoices = input.sizes.length ? input.sizes.map((code) => sizes.get(code)!) : [undefined]
  for (const size of sizeChoices) {
    for (const colourCode of input.colours) {
      combinations.push({ colour: colours.get(colourCode)!, size })
    }
    for (const customName of input.customColours) combinations.push({ customName, size })
  }

  const productType = products.docs[0].setDetails?.productType
  for (const code of input.sizes) {
    const problem = sizeNotAllowedMessage(productType, code)
    if (problem) fail(problem)
  }

  const existing = await payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 1000,
    overrideAccess: true,
    pagination: false,
    req,
    where: { product: { equals: productID } },
  })
  const taken = new Set(
    existing.docs.map((variant) => `${variant.sizeCode ?? ''}|${variant.colorCode}`),
  )

  const created: Array<{ id: number; sku: string }> = []
  let skipped = 0
  for (const combo of combinations) {
    const colourCode = combo.colour?.code ?? normalizeCode(combo.customName ?? '')
    const sizeKey = combo.size?.code ?? ''
    if (taken.has(`${sizeKey}|${colourCode}`)) {
      skipped += 1
      continue
    }
    const variant = await payload.create({
      collection: 'product-variants',
      data: {
        colour: combo.colour?.id,
        compareAtPricePaise: input.compareAtPricePaise,
        customColourName: combo.customName,
        maxPerOrder: input.maxPerOrder,
        // A price typed for one size wins over the price for all sizes.
        pricePaise: (input.priceBySize?.[sizeKey] ?? input.price) as number,
        product: productID,
        saveToColourLibrary: combo.customName ? input.saveToLibrary : false,
        size: combo.size?.id,
        status: input.status,
      } as never,
      overrideAccess: true,
      req,
    })
    const opening = input.stock?.[`${sizeKey}|${colourCode}`] ?? input.defaultStock ?? 0
    await payload.create({
      collection: 'inventory',
      context: {
        inventoryAdjustment: { note: 'Created by variant generator', reason: 'initial_stock' },
      },
      data: {
        onHand: opening,
        reorderPoint: 0,
        reserved: 0,
        stockStatus: opening > 0 ? 'available' : 'out_of_stock',
        variant: variant.id,
      },
      overrideAccess: true,
      req,
    })
    taken.add(`${sizeKey}|${variant.colorCode ?? colourCode}`)
    created.push({ id: variant.id, sku: variant.sku })
  }

  return { created, createdCount: created.length, skippedCount: skipped }
}
