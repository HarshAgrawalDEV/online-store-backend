import { sql } from '@payloadcms/db-postgres'
import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
} from 'payload'

import { relationshipID } from '../lib/catalog'
import { validateJewelleryComponents } from '../lib/jewellery'
import { isSetDetailsComplete, validateSetDetails, type SetDetails } from '../lib/set-details'

type Db = {
  drizzle: { execute: (query: unknown) => Promise<{ rows: Array<Record<string, unknown>> }> }
}

type JewelleryData = {
  components?: Array<{ piece?: unknown; quantity?: null | number }> | null
  finish?: unknown
}

const fail = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}

/** Every new design gets the next number once. It is never reused or changed. */
export const assignDesignNumber: CollectionBeforeValidateHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create' || !data || data.designNumber) return data
  const db = req.payload.db as unknown as Db
  const result = await db.drizzle.execute(sql`SELECT nextval('product_design_number_seq') AS n`)
  return { ...data, designNumber: Number(result.rows[0]?.n) }
}

export const enforceProductPublication: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const department = (data.department ?? originalDoc?.department ?? 'bangles') as string
  const isJewellery = department === 'jewellery'

  // A product sits in a category of its own department.
  const categoryID = relationshipID(data.primaryCategory ?? originalDoc?.primaryCategory)
  if (categoryID && (data.primaryCategory !== undefined || data.department !== undefined)) {
    const category = await req.payload
      .findByID({ collection: 'categories', depth: 0, id: categoryID, overrideAccess: true, req })
      .catch(() => null)
    if (category && category.department !== department) {
      fail(
        `"${category.name}" is a ${category.department} category. Pick a ${department} category, or change the department.`,
      )
    }
  }

  const jewellery = {
    ...((originalDoc?.jewellery as JewelleryData | undefined) ?? {}),
    ...((data.jewellery as JewelleryData | undefined) ?? {}),
  }
  const setDetails = {
    ...((originalDoc?.setDetails as SetDetails | undefined) ?? {}),
    ...((data.setDetails as SetDetails | undefined) ?? {}),
  }

  if (isJewellery) {
    const problem = validateJewelleryComponents(jewellery.components)
    if (problem) fail(problem)
  } else {
    const setProblem = validateSetDetails(setDetails)
    if (setProblem) fail(setProblem)
  }

  const nextStatus = data.status ?? originalDoc?.status
  if (nextStatus !== 'active') return data

  const productID = relationshipID(originalDoc)
  const featuredImage = data.featuredImage ?? originalDoc?.featuredImage

  if (!productID) fail('Create the product as a draft before publishing it.')
  if (!relationshipID(featuredImage)) fail('An active product requires a featured image.')

  if (isJewellery) {
    if (!(jewellery.components ?? []).length) {
      fail('An active jewellery product requires at least one part, such as a necklace.')
    }
    if (!relationshipID(jewellery.finish)) fail('An active jewellery product requires a finish.')
  } else {
    if (!relationshipID(data.material ?? originalDoc?.material))
      fail('An active product requires a material.')
    if (!isSetDetailsComplete(setDetails))
      fail('An active product requires a product type and the total number of pieces.')
  }

  const variants = await req.payload.count({
    collection: 'product-variants',
    overrideAccess: true,
    req,
    where: {
      and: [{ product: { equals: productID } }, { status: { equals: 'active' } }],
    },
  })

  if (variants.totalDocs === 0) fail('An active product requires an active variant.')

  return {
    ...data,
    publishedAt: data.publishedAt ?? originalDoc?.publishedAt ?? new Date().toISOString(),
  }
}
