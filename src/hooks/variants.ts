import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook } from 'payload'

import { normalizeCode, relationshipID } from '../lib/catalog'

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
  const optionValues = (data.optionValues ?? originalDoc?.optionValues ?? []) as Array<{
    attribute?: unknown
    option?: unknown
  }>

  const signature = [
    sizeCode ? `size=${normalizeCode(String(sizeCode))}` : '',
    colorCode ? `color=${normalizeCode(String(colorCode))}` : '',
    finishCode ? `finish=${normalizeCode(String(finishCode))}` : '',
    ...optionValues
      .map(({ attribute, option }) => {
        const attributeID = relationshipID(attribute)
        const optionID = relationshipID(option)
        return attributeID && optionID ? `attribute-${attributeID}=${optionID}` : ''
      })
      .filter(Boolean)
      .sort(),
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
