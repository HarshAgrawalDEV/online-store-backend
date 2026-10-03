import type { CollectionBeforeChangeHook } from 'payload'

import { relationshipID } from '../lib/catalog'

export const enforceProductPublication: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const nextStatus = data.status ?? originalDoc?.status
  if (nextStatus !== 'active') return data

  const productID = relationshipID(originalDoc)
  const featuredImage = data.featuredImage ?? originalDoc?.featuredImage

  if (!productID) throw new Error('Create the product as a draft before publishing it.')
  if (!relationshipID(featuredImage))
    throw new Error('An active product requires a featured image.')

  const variants = await req.payload.count({
    collection: 'product-variants',
    overrideAccess: true,
    req,
    where: {
      and: [{ product: { equals: productID } }, { status: { equals: 'active' } }],
    },
  })

  if (variants.totalDocs === 0) throw new Error('An active product requires an active variant.')

  return {
    ...data,
    publishedAt: data.publishedAt ?? originalDoc?.publishedAt ?? new Date().toISOString(),
  }
}
