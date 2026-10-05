import type { Payload } from 'payload'

import {
  expandQueryWords,
  fuzzyCandidates,
  normalizeSearchText,
  queryWords,
  toTsQueryText,
} from '../../lib/search-text'
import { type Executor, rowsFrom, sql, withTypoTolerance } from './db'
import { loadSynonymIndex } from './synonyms'

/** Most products one search can return. Filters and paging then work on this ranked list. */
export const MAX_SEARCH_RESULTS = 300

export type SearchHit = { id: number; name: string; slug: string }

export type SearchResult = {
  /** Product ids, best match first. */
  ids: number[]
  /** True when no product matched every word, so products matching some words are shown. */
  relaxed: boolean
  hits: SearchHit[]
}

type Row = { name: string; product_id: number; slug: string }

type WordMatch = { alternatives: string[]; fuzzy: string[]; tsquery?: string }

/** SQL condition and score for one query word, counting its synonyms and near-spellings. */
const wordSql = ({ alternatives, fuzzy, tsquery }: WordMatch) => {
  const conditions = [
    ...(tsquery ? [sql`d.tsv @@ to_tsquery('simple', ${tsquery})`] : []),
    ...fuzzy.map((word) => sql`${word} <% d.body`),
  ]
  const exact = tsquery ? sql`d.tsv @@ to_tsquery('simple', ${tsquery})` : sql`false`
  const similarity = fuzzy.length
    ? sql`GREATEST(${sql.join(
        fuzzy.map((word) => sql`word_similarity(${word}, d.body)`),
        sql`, `,
      )})`
    : sql`0`
  return {
    condition: conditions.length ? sql`(${sql.join(conditions, sql` OR `)})` : sql`false`,
    score: sql`(CASE WHEN ${exact} THEN 1.0 + ts_rank_cd(d.tsv, to_tsquery('simple', ${tsquery ?? ''})) ELSE ${similarity} * 0.6 END)`,
    usable: Boolean(tsquery) || fuzzy.length > 0,
    alternatives,
  }
}

const run = async (
  executor: Executor,
  matches: WordMatch[],
  mode: 'all' | 'any',
  limit: number,
): Promise<Row[]> => {
  const words = matches.map(wordSql).filter((word) => word.usable)
  if (!words.length) return []
  const where =
    mode === 'all'
      ? sql.join(
          words.map((word) => word.condition),
          sql` AND `,
        )
      : sql`(${sql.join(
          words.map((word) => word.condition),
          sql` OR `,
        )})`
  const score = sql.join(
    words.map((word) => word.score),
    sql` + `,
  )
  return rowsFrom<Row>(
    executor,
    sql`
      SELECT d.product_id, d.name, d.slug
      FROM search_documents d
      WHERE ${where}
      ORDER BY (${score}) DESC, d.in_stock DESC, d.is_featured DESC, d.published_at DESC NULLS LAST, d.product_id DESC
      LIMIT ${limit}
    `,
  )
}

/**
 * Ranked product ids for a customer's text. Every word must match (name, category, material,
 * colour, size, occasion, SKU...), allowing synonyms, prefixes and small typos. When nothing
 * matches all the words, products matching some of them are returned and `relaxed` is set.
 */
export const searchProducts = async (
  payload: Payload,
  text: string,
  limit = MAX_SEARCH_RESULTS,
): Promise<SearchResult> => {
  const words = queryWords(text)
  if (!words.length) return { hits: [], ids: [], relaxed: false }

  const synonyms = await loadSynonymIndex(payload)
  const matches: WordMatch[] = expandQueryWords(words, synonyms).map((alternatives) => ({
    alternatives,
    // Typo matching only for the word as typed; synonyms are matched exactly, or short ones
    // such as "kara" would also match "karwa".
    fuzzy: fuzzyCandidates(alternatives.slice(0, 1)),
    tsquery: toTsQueryText(alternatives),
  }))

  const { rows, relaxed } = await withTypoTolerance(payload, async (executor) => {
    const exact = await run(executor, matches, 'all', limit)
    if (exact.length || matches.length < 2) return { relaxed: false, rows: exact }
    const partial = await run(executor, matches, 'any', limit)
    return { relaxed: partial.length > 0, rows: partial }
  })
  return {
    hits: rows.map((row) => ({ id: Number(row.product_id), name: row.name, slug: row.slug })),
    ids: rows.map((row) => Number(row.product_id)),
    relaxed,
  }
}

/** A few product names to show while the customer is still typing. */
export const suggestProducts = async (payload: Payload, text: string): Promise<SearchHit[]> => {
  if (normalizeSearchText(text).length < 2) return []
  return (await searchProducts(payload, text, 8)).hits
}

/** Records a search for the "not found" report. Never throws and never blocks the response. */
export const logSearch = (
  payload: Payload,
  text: string,
  resultCount: number,
  relaxed: boolean,
): void => {
  const normalized = normalizeSearchText(text).slice(0, 120)
  if (normalized.length < 2) return
  void payload
    .create({
      collection: 'search-queries',
      data: { normalizedQuery: normalized, query: text.slice(0, 120), relaxed, resultCount },
      overrideAccess: true,
    })
    .catch((error) => payload.logger.warn({ err: error, msg: 'Search log write failed' }))
}
