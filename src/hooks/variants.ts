import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeValidateHook,
  type PayloadRequest,
} from 'payload'

import { normalizeCode, relationshipID } from '../lib/catalog'
import { buildJewellerySku } from '../lib/jewellery'
import {
  buildSku,
  type ProductType,
  shortCodeFromName,
  sizeNotAllowedMessage,
} from '../lib/set-details'

type Doc = Record<string, unknown>

const titleCase = (value: string): string =>
  value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

const loadDoc = async (
  req: PayloadRequest,
  collection: 'colours' | 'products' | 'sizes',
  id: unknown,
  depth = 0,
) => {
  const docID = relationshipID(id)
  if (!docID) return undefined
  try {
    return (await req.payload.findByID({
      collection,
      id: docID,
      depth,
      overrideAccess: true,
      req,
    })) as unknown as Doc
  } catch {
    return undefined
  }
}

/** Library colour for a one-off colour name, creating it when it is not there yet. */
const saveColourToLibrary = async (req: PayloadRequest, name: string): Promise<number> => {
  const code = normalizeCode(name)
  const existing = await req.payload.find({
    collection: 'colours',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { code: { equals: code } },
  })
  if (existing.docs[0]) return existing.docs[0].id
  const created = await req.payload.create({
    collection: 'colours',
    data: { code, isActive: true, name, shortCode: shortCodeFromName(name), sortOrder: 900 },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return created.id
}

const uniqueSku = async (req: PayloadRequest, base: string): Promise<string> => {
  let candidate = base
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const taken = await req.payload.count({
      collection: 'product-variants',
      overrideAccess: true,
      req,
      where: { sku: { equals: candidate } },
    })
    if (taken.totalDocs === 0) return candidate
    candidate = `${base}-${attempt}`
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`
}

/**
 * Fills everything derived from the size and colour libraries before validation:
 * size and colour codes and labels, the one-off colour flow, and an automatic SKU.
 * Plain sizeCode/colorCode values still work when no library entry is chosen.
 */
export const prepareVariant: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const next: Doc = { ...data }
  const read = (key: string): unknown => (key in next ? next[key] : originalDoc?.[key])

  // Size
  const size = await loadDoc(req, 'sizes', read('size'))
  if (size) {
    next.sizeCode = String(size.code)
    next.sizeLabel = String(size.label ?? size.code)
  } else {
    const code = read('sizeCode')
    next.sizeLabel = code ? String(code) : null
  }

  // Some product types are only sold in certain sizes.
  if (next.sizeCode && (operation === 'create' || 'size' in data)) {
    const owner = await loadDoc(req, 'products', read('product'))
    const problem = sizeNotAllowedMessage(
      (owner?.setDetails as { productType?: string } | undefined)?.productType,
      String(next.sizeCode),
    )
    if (problem) throw new APIError(problem, 400, undefined, true)
  }

  // Colour: library entry, a one-off name (optionally saved to the library), or a plain code
  const customName = String(read('customColourName') ?? '').trim()
  if (next.saveToColourLibrary === true && customName && !relationshipID(read('colour'))) {
    next.colour = await saveColourToLibrary(req, customName)
    next.customColourName = null
  }
  if (next.saveToColourLibrary !== undefined) next.saveToColourLibrary = false

  const colour = await loadDoc(req, 'colours', read('colour'))
  const remainingCustom = String(read('customColourName') ?? '').trim()
  if (colour) {
    next.colorCode = String(colour.code)
    next.colourLabel = String(colour.name)
  } else if (remainingCustom) {
    next.colorCode = normalizeCode(remainingCustom)
    next.colourLabel = remainingCustom
  } else {
    const code = read('colorCode')
    next.colourLabel = code ? titleCase(String(code)) : null
  }

  // Automatic SKU for new variants
  if (operation === 'create' && !String(next.sku ?? '').trim()) {
    const product = await loadDoc(req, 'products', read('product'), 1)
    const material = (product?.material ?? undefined) as Doc | number | undefined
    const setDetails = (product?.setDetails ?? {}) as {
      piecesTotal?: number
      productType?: ProductType
    }
    const category = (product?.primaryCategory ?? undefined) as Doc | number | undefined
    const colourShortCode = colour
      ? String(colour.shortCode ?? shortCodeFromName(String(colour.name)))
      : remainingCustom
        ? shortCodeFromName(remainingCustom)
        : undefined
    const base =
      (product?.department === 'jewellery'
        ? buildJewellerySku({
            categoryCode: typeof category === 'object' ? (category.skuCode as string) : undefined,
            colourShortCode,
            designNumber: product?.designNumber as number | undefined,
            sizeCode: next.sizeCode ? String(next.sizeCode) : undefined,
          })
        : buildSku({
            colourShortCode,
            designNumber: product?.designNumber as number | undefined,
            materialCode: typeof material === 'object' ? String(material.code ?? '') : undefined,
            piecesTotal: setDetails.piecesTotal,
            productType: setDetails.productType,
            sizeCode: next.sizeCode ? String(next.sizeCode) : undefined,
          })) || `SKU-${Date.now().toString(36).toUpperCase()}`
    next.sku = await uniqueSku(req, base)
  }

  return next
}

const assertAnotherActiveVariant = async (
  req: Parameters<CollectionBeforeDeleteHook>[0]['req'],
  variantID: number | string,
  productID: number | string,
) => {
  const product = await req.payload.findByID({
    collection: 'products',
    id: productID,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (product.status !== 'active') return

  const remaining = await req.payload.count({
    collection: 'product-variants',
    overrideAccess: true,
    req,
    where: {
      and: [
        { product: { equals: productID } },
        { status: { equals: 'active' } },
        { id: { not_equals: variantID } },
      ],
    },
  })

  if (remaining.totalDocs === 0) {
    throw new Error(
      'Archive the product or activate another variant before removing its last active variant.',
    )
  }
}

export const normalizeVariant: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const sizeCode = data.sizeCode === undefined ? originalDoc?.sizeCode : data.sizeCode
  const colorCode = data.colorCode === undefined ? originalDoc?.colorCode : data.colorCode
  const finishCode = data.finishCode === undefined ? originalDoc?.finishCode : data.finishCode

  const signature = [
    sizeCode ? `size=${normalizeCode(String(sizeCode))}` : '',
    colorCode ? `color=${normalizeCode(String(colorCode))}` : '',
    finishCode ? `finish=${normalizeCode(String(finishCode))}` : '',
  ]
    .filter(Boolean)
    .join('|')

  const nextStatus = data.status ?? originalDoc?.status
  if (originalDoc?.status === 'active' && nextStatus !== 'active') {
    const productID = relationshipID(data.product ?? originalDoc.product)
    const variantID = relationshipID(originalDoc)
    if (productID && variantID) await assertAnotherActiveVariant(req, variantID, productID)
  }

  return {
    ...data,
    sku: data.sku ? String(data.sku).trim().toUpperCase() : data.sku,
    sizeCode: sizeCode ? String(sizeCode).trim() : null,
    colorCode: colorCode ? normalizeCode(String(colorCode)) : null,
    finishCode: finishCode ? normalizeCode(String(finishCode)) : null,
    optionSignature: signature || 'default',
  }
}

export const preventDeletingLastActiveVariant: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const variant = await req.payload.findByID({
    collection: 'product-variants',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const productID = relationshipID(variant.product)

  if (variant.status === 'active' && productID) {
    await assertAnotherActiveVariant(req, id, productID)
  }
}
