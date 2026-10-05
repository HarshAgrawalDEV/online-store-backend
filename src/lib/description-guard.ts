/**
 * Boor looks like ivory but is not. Generated text must never suggest otherwise, so any draft that
 * mentions these words is rejected. The colour is called cream in prose; "Ivory" stays a colour
 * name in the library only.
 */
const FORBIDDEN = [/\bivor(y|ies)\b/i, /\btusks?\b/i, /\bhath(i|ee)\s*-?dant\b/i, /\belephants?\b/i]

/**
 * Jewellery here is imitation. Claiming gold, diamonds, real stones or a hallmark would be a false
 * description, so those words are rejected unless they are clearly "-look" or a colour name:
 * "gold-look polish", "pearl-look beads" and "ruby red" pass; "gold", "pearls" and "real" do not.
 */
const LOOK = '(?:look|like|tone|toned|polish|polished|finish|colou?r(?:ed)?)'
const FORBIDDEN_JEWELLERY = [
  new RegExp(`\\bgold\\b(?![ -]?${LOOK})`, 'i'),
  new RegExp(`\\bdiamonds?\\b(?![ -]?(?:${LOOK}|shaped))`, 'i'),
  new RegExp(
    `\\b(?:rubies|ruby|emeralds?|sapphires?)\\b(?![ -]?(?:${LOOK}|red|green|blue|pink))`,
    'i',
  ),
  new RegExp(`(?<!faux |imitation |artificial )\\bpearls?\\b(?![ -]?(?:${LOOK}|beads?))`, 'i'),
  /\b(?:real|genuine|authentic|pure|hallmark(?:ed)?|certified|karat|carat)\b/i,
  /\b\d{2} ?k(?:t|arat)?\b/i,
  /\bplatinum\b/i,
]

export const findForbiddenWording = (text: string, department?: null | string): string | null => {
  const patterns = department === 'jewellery' ? [...FORBIDDEN, ...FORBIDDEN_JEWELLERY] : FORBIDDEN
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return match[0]
  }
  return null
}

/**
 * Words that belong to a different product. A bangle set is not a kada and not a chuda; mixing them
 * up would mislead customers, so a draft that does is sent back for another try.
 */
const WRONG_TERMS: Record<string, RegExp[]> = {
  bangle_set: [/\bkadas?\b/i, /\bchudas?\b/i],
  kada_pair: [/\bchudas?\b/i],
  complete_set: [/\bchudas?\b/i],
  chuda_set: [/\bkadas?\b/i],
}

export const findWrongTerm = (text: string, productType?: null | string): null | string => {
  for (const pattern of WRONG_TERMS[productType ?? ''] ?? []) {
    const match = pattern.exec(text)
    if (match) return match[0]
  }
  return null
}

/** Plain text into the Lexical document Payload stores: one paragraph per blank-line block. */
export const textToLexical = (text: string) => ({
  root: {
    type: 'root',
    children: text
      .split(/\n\s*\n/)
      .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
      .map((paragraph) => ({
        type: 'paragraph',
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: paragraph,
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        version: 1,
      })),
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
  },
})
