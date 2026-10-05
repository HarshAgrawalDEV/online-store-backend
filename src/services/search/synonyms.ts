import type { Payload } from 'payload'

import { buildSynonymIndex, DEFAULT_SYNONYM_GROUPS, type SynonymIndex } from '../../lib/search-text'

const CACHE_MS = 60_000
let cached: { at: number; index: SynonymIndex } | undefined

/** Built-in groups plus the active ones staff added in the admin. Cached for a minute. */
export const loadSynonymIndex = async (payload: Payload): Promise<SynonymIndex> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.index
  let staffGroups: string[][] = []
  try {
    const result = await payload.find({
      collection: 'search-synonyms',
      depth: 0,
      limit: 500,
      overrideAccess: true,
      pagination: false,
      where: { isActive: { equals: true } },
    })
    staffGroups = result.docs.map((doc) => (doc.terms ?? []).map(({ term }) => term))
  } catch (error) {
    payload.logger.warn({
      err: error,
      msg: 'Search synonyms could not be loaded; using built-in ones',
    })
  }
  const index = buildSynonymIndex([...DEFAULT_SYNONYM_GROUPS, ...staffGroups])
  cached = { at: Date.now(), index }
  return index
}

export const clearSynonymCache = (): void => {
  cached = undefined
}
