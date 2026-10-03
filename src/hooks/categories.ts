import type { CollectionBeforeChangeHook } from 'payload'

import { relationshipID } from '../lib/catalog'

export const preventCategoryCycles: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const parentID = relationshipID(data.parent)
  const categoryID = relationshipID(originalDoc)
  if (!parentID || !categoryID) return data
  if (String(parentID) === String(categoryID))
    throw new Error('A category cannot be its own parent.')

  const visited = new Set([String(categoryID)])
  let cursor: number | string | undefined = parentID

  while (cursor) {
    if (visited.has(String(cursor))) throw new Error('Category parents cannot form a cycle.')
    visited.add(String(cursor))

    const parent = await req.payload.findByID({
      collection: 'categories',
      id: cursor,
      depth: 0,
      overrideAccess: true,
      req,
    })
    cursor = relationshipID(parent.parent)
  }

  return data
}
