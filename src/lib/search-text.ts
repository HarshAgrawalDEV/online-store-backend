/**
 * Pure text helpers for product search. Nothing here touches the database, so the same
 * normalisation is used when a product is indexed and when a customer types a query.
 */

/** Words that never help find a product ("bangles for wedding" searches "bangle wedding"). */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'buy',
  'for',
  'from',
  'in',
  'me',
  'my',
  'of',
  'online',
  'or',
  'size',
  'the',
  'to',
  'with',
])

export const MAX_SEARCH_WORDS = 6
export const MAX_SEARCH_LENGTH = 80

/** "bangles" and "bangle" must match each other; keeps "glass" and short words as they are. */
export const stemLite = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word

/**
 * Lower-case, strip accents and punctuation, and write sizes as one token ("2-6" and "2.6"
 * become "2x6") so a customer can type a size however they like.
 */
export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\b(\d{1,2})\s?[-.]\s?(\d{1,2})\b/g, '$1x$2')
    // Marks (\p{M}) stay: Devanagari vowel signs are marks, and dropping them would split words.
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Words used for indexing: normalised and lightly stemmed, stop words kept out. */
export const tokenize = (value: string): string[] =>
  normalizeSearchText(value).split(' ').filter(Boolean).map(stemLite)

/** Words used for querying: as above, without stop words and duplicates, capped. */
export const queryWords = (value: string): string[] => {
  const words = tokenize(value.slice(0, MAX_SEARCH_LENGTH)).filter(
    (word) => !STOP_WORDS.has(word) && (word.length > 1 || /\d/.test(word)),
  )
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS)
}

/** Text stored in the search index for one piece of product information. */
export const indexText = (
  ...parts: Array<null | string | undefined | Array<null | string | undefined>>
) =>
  parts
    .flat()
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => tokenize(part).join(' '))
    .filter(Boolean)
    .join(' ')

/* ------------------------------------------------------------------ synonyms */

/** Words that mean the same thing to a customer. Staff add more in the admin ("Search synonyms"). */
export const DEFAULT_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['kada', 'kara', 'kangan', 'kade', 'कड़ा', 'कडा'],
  ['chuda', 'choora', 'chura', 'chooda', 'chhuda', 'चूड़ा', 'चूडा'],
  ['bangle', 'churi', 'chudi', 'chudiya', 'चूड़ी', 'चूडी'],
  ['lakh', 'lac', 'laakh', 'lakhi', 'लाख'],
  ['glass', 'kaanch', 'kanch', 'kaach', 'काँच', 'कांच'],
  ['boor', 'bor'],
  ['chiku', 'chikoo', 'chickoo', 'chikku'],
  ['maroon', 'marun'],
  ['wedding', 'shaadi', 'shadi', 'vivah'],
  ['bridal', 'dulhan', 'bride'],
  ['diwali', 'deepavali', 'dipawali'],
  ['teej', 'teez'],
]

export type SynonymIndex = Map<string, string[]>

/** word -> every word in its groups (including itself), all normalised the same way as queries. */
export const buildSynonymIndex = (groups: readonly (readonly string[])[]): SynonymIndex => {
  const index = new Map<string, Set<string>>()
  for (const group of groups) {
    const words = [...new Set(group.flatMap((term) => tokenize(term)))]
    if (words.length < 2) continue
    for (const word of words) {
      const set = index.get(word) ?? new Set<string>()
      for (const other of words) set.add(other)
      index.set(word, set)
    }
  }
  return new Map([...index].map(([word, set]) => [word, [...set]]))
}

/** Alternatives for each query word. A word without synonyms stands alone. */
export const expandQueryWords = (words: string[], synonyms: SynonymIndex): string[][] =>
  words.map((word) => {
    const group = synonyms.get(word)
    return group ? [word, ...group.filter((other) => other !== word)] : [word]
  })

/** Postgres tsquery text: every alternative is a prefix match, alternatives are OR-ed. */
export const toTsQueryText = (alternatives: string[]): string | undefined => {
  const safe = alternatives.filter((word) => /^[a-z0-9_]+$/.test(word))
  return safe.length ? safe.map((word) => `${word}:*`).join(' | ') : undefined
}

/** Words long enough for typo matching; short words only match exactly. */
export const fuzzyCandidates = (alternatives: string[]): string[] =>
  alternatives.filter((word) => word.length >= 4 && /^[a-z0-9_]+$/.test(word))
