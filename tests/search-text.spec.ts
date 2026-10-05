import { describe, expect, it } from 'vitest'

import {
  buildSynonymIndex,
  DEFAULT_SYNONYM_GROUPS,
  expandQueryWords,
  fuzzyCandidates,
  indexText,
  normalizeSearchText,
  queryWords,
  toTsQueryText,
} from '@/lib/search-text'
import { parseCatalogFilters } from '@/services/catalog-query'

describe('search text normalisation', () => {
  it('lower-cases, drops punctuation and writes sizes as one word', () => {
    expect(normalizeSearchText('  Rani  Chuda, Size 2-6! ')).toBe('rani chuda size 2x6')
    expect(normalizeSearchText('2.6')).toBe('2x6')
    expect(normalizeSearchText('Café Crème')).toBe('cafe creme')
  })

  it('treats plurals as the same word but leaves glass alone', () => {
    expect(queryWords('bangles')).toEqual(['bangle'])
    expect(queryWords('glass kadas')).toEqual(['glass', 'kada'])
  })

  it('drops filler words and repeats, and caps the number of words', () => {
    expect(queryWords('bangles for the wedding in rani')).toEqual(['bangle', 'wedding', 'rani'])
    expect(queryWords('kada kada kada')).toEqual(['kada'])
    expect(queryWords('a b c d e f g h i j').length).toBeLessThanOrEqual(6)
  })

  it('keeps the same form for indexing and querying', () => {
    expect(indexText('Lakh Kada Pair', ['Maroon', undefined], 'Size 2-6')).toBe(
      'lakh kada pair maroon size 2x6',
    )
    expect(queryWords('lakh kada 2-6')).toEqual(['lakh', 'kada', '2x6'])
  })
})

describe('search synonyms', () => {
  const synonyms = buildSynonymIndex(DEFAULT_SYNONYM_GROUPS)

  it('finds a kada whatever the customer calls it', () => {
    const [alternatives] = expandQueryWords(['kangan'], synonyms)
    expect(alternatives).toEqual(expect.arrayContaining(['kangan', 'kada', 'kara']))
  })

  it('maps Hindi spellings to the English words', () => {
    const [alternatives] = expandQueryWords(['चूड़ा'], synonyms)
    expect(alternatives).toEqual(expect.arrayContaining(['chuda', 'choora']))
  })

  it('leaves unknown words alone', () => {
    expect(expandQueryWords(['teal'], synonyms)).toEqual([['teal']])
  })

  it('includes staff-added groups', () => {
    const custom = buildSynonymIndex([['pink', 'gulabi']])
    expect(expandQueryWords(['gulabi'], custom)[0]).toEqual(['gulabi', 'pink'])
  })
})

describe('search query building', () => {
  it('builds a prefix query that ORs the alternatives', () => {
    expect(toTsQueryText(['kada', 'kara'])).toBe('kada:* | kara:*')
  })

  it('leaves out anything that is not a plain word', () => {
    expect(toTsQueryText(["x'); drop", 'कड़ा'])).toBeUndefined()
    expect(toTsQueryText(['kada', 'कड़ा'])).toBe('kada:*')
  })

  it('only allows typo matching on words of four or more letters', () => {
    expect(fuzzyCandidates(['rani', 'red', 'kangan'])).toEqual(['rani', 'kangan'])
  })
})

describe('catalog search sorting', () => {
  it('ranks by relevance when there is a search and no sort', () => {
    expect(parseCatalogFilters('http://x/api/catalog/products?search=rani').sort).toBe('relevance')
  })

  it('keeps newest as the default without a search', () => {
    expect(parseCatalogFilters('http://x/api/catalog/products').sort).toBe('newest')
  })

  it('respects an explicit sort', () => {
    expect(
      parseCatalogFilters('http://x/api/catalog/products?search=rani&sort=price-low').sort,
    ).toBe('price-low')
  })
})
