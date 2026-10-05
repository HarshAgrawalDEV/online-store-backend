import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'

import { relationshipID } from '../lib/catalog'
import { clearSynonymCache } from '../services/search/synonyms'
import { scheduleFullSearchReindex, scheduleSearchReindex } from '../services/search/indexer'

/**
 * Keeps the search index in step with the catalogue. The hooks only queue work: the actual
 * re-indexing runs a moment later, outside the save, so a search problem can never block a save,
 * an order or a stock change.
 */

/** The part of the after-change and after-delete hook arguments these hooks use. */
type Change = (args: { doc: Record<string, unknown>; req: PayloadRequest }) => void

const productChanged: Change = ({ doc, req }) => {
  scheduleSearchReindex(req.payload, { productIds: [doc.id as number] })
}

const variantChanged: Change = ({ doc, req }) => {
  scheduleSearchReindex(req.payload, { productIds: [relationshipID(doc.product) as number] })
}

const stockChanged: Change = ({ doc, req }) => {
  scheduleSearchReindex(req.payload, { variantIds: [relationshipID(doc.variant) as number] })
}

const libraryChanged: Change = ({ req }) => {
  scheduleFullSearchReindex(req.payload)
}

const synonymsChanged: Change = () => {
  clearSynonymCache()
}

const hooksBySlug: Record<string, Change> = {
  categories: libraryChanged,
  collections: libraryChanged,
  colours: libraryChanged,
  finishes: libraryChanged,
  inventory: stockChanged,
  'jewellery-styles': libraryChanged,
  materials: libraryChanged,
  occasions: libraryChanged,
  'piece-types': libraryChanged,
  'product-variants': variantChanged,
  products: productChanged,
  'search-synonyms': synonymsChanged,
  sizes: libraryChanged,
  'stone-types': libraryChanged,
}

/** Adds the index-update hooks to every collection whose data appears in search. */
export const withSearchIndexHooks = (collection: CollectionConfig): CollectionConfig => {
  const hook = hooksBySlug[collection.slug]
  if (!hook) return collection
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [
        ...(collection.hooks?.afterChange ?? []),
        hook as unknown as CollectionAfterChangeHook,
      ],
      afterDelete: [
        ...(collection.hooks?.afterDelete ?? []),
        hook as unknown as CollectionAfterDeleteHook,
      ],
    },
  }
}
