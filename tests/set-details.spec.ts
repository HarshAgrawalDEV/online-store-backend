import { describe, expect, it } from 'vitest'

import { findForbiddenWording, findWrongTerm, textToLexical } from '../src/lib/description-guard'
import {
  buildSku,
  describeVariantLine,
  resolveSetDetails,
  validateSetDetails,
} from '../src/lib/set-details'

describe('set details', () => {
  it('accepts the real product shapes', () => {
    expect(
      validateSetDetails({ kadaCount: 0, piecesTotal: 12, productType: 'bangle_set' }),
    ).toBeFalsy()
    expect(
      validateSetDetails({ kadaCount: 2, piecesTotal: 2, productType: 'kada_pair' }),
    ).toBeFalsy()
    expect(
      validateSetDetails({ kadaCount: 2, piecesTotal: 6, productType: 'complete_set' }),
    ).toBeFalsy()
    expect(
      validateSetDetails({ kadaCount: 0, piecesTotal: 10, productType: 'chuda_set' }),
    ).toBeFalsy()
  })

  it('rejects odd totals and wrong kada counts', () => {
    expect(validateSetDetails({ piecesTotal: 5, productType: 'bangle_set' })).toBeTruthy()
    expect(
      validateSetDetails({ kadaCount: 2, piecesTotal: 4, productType: 'kada_pair' }),
    ).toBeTruthy()
    expect(
      validateSetDetails({ kadaCount: 1, piecesTotal: 6, productType: 'complete_set' }),
    ).toBeTruthy()
    expect(
      validateSetDetails({ kadaCount: 2, piecesTotal: 8, productType: 'chuda_set' }),
    ).toBeTruthy()
  })

  it('resolves pieces per hand and bangle count', () => {
    expect(
      resolveSetDetails({ kadaCount: 2, piecesTotal: 6, productType: 'complete_set' }),
    ).toMatchObject({
      bangleCount: 4,
      piecesPerHand: 3,
    })
    expect(resolveSetDetails({ piecesTotal: 10, productType: 'chuda_set' })?.piecesPerHand).toBe(5)
  })
})

describe('sku and order line wording', () => {
  it('builds the agreed SKU shapes', () => {
    expect(
      buildSku({
        colourShortCode: 'TEAL',
        designNumber: 14,
        materialCode: 'GLS',
        piecesTotal: 12,
        productType: 'bangle_set',
        sizeCode: '2-4',
      }),
    ).toBe('GLS-BNG12-014-TEAL-24')
    expect(
      buildSku({
        colourShortCode: 'RANI',
        designNumber: 7,
        materialCode: 'BOR',
        piecesTotal: 10,
        productType: 'chuda_set',
        sizeCode: '2-6',
      }),
    ).toBe('BOR-CHD5-007-RANI-26')
    expect(
      buildSku({
        colourShortCode: 'REDGRN',
        designNumber: 3,
        materialCode: 'LAK',
        piecesTotal: 2,
        productType: 'kada_pair',
        sizeCode: '2-8',
      }),
    ).toBe('LAK-KDP-003-REDGRN-28')
  })

  it('describes a chuda line for the order', () => {
    expect(
      describeVariantLine({
        colourName: 'Rani',
        materialName: 'Boor',
        piecesTotal: 10,
        productType: 'chuda_set',
        sizeLabel: '2-6',
      }),
    ).toBe('Boor · Chuda · 5 per hand (10 pcs) · Size 2-6 · Rani')
  })
})

describe('description guard', () => {
  it('blocks ivory, tusk and elephant wording', () => {
    for (const text of ['Real ivory look', 'made from TUSK', 'hathi dant chuda', 'elephant bone']) {
      expect(findForbiddenWording(text)).toBeTruthy()
    }
    expect(findForbiddenWording('A cream coloured Boor chuda.')).toBeFalsy()
  })

  it('turns blank-line blocks into paragraphs', () => {
    const doc = textToLexical('One.\n\nTwo\nlines.')
    expect(doc.root.children.map((p) => p.children[0].text)).toEqual(['One.', 'Two lines.'])
  })
})

describe('product wording', () => {
  it('stops a bangle set being called a kada or chuda', () => {
    expect(findWrongTerm('Each kada has a sparkle', 'bangle_set')).toBeTruthy()
    expect(findWrongTerm('This lovely chuda', 'bangle_set')).toBeTruthy()
    expect(findWrongTerm('Twelve glass bangles', 'bangle_set')).toBeFalsy()
  })

  it('keeps chuda and kada for the products they belong to', () => {
    expect(findWrongTerm('A bridal chuda', 'chuda_set')).toBeFalsy()
    expect(findWrongTerm('A bridal kada', 'chuda_set')).toBeTruthy()
    expect(findWrongTerm('A pair of kadas', 'kada_pair')).toBeFalsy()
    expect(findWrongTerm('Two kadas and four bangles', 'complete_set')).toBeFalsy()
  })
})

describe('imitation jewellery wording', () => {
  it('blocks claims of real gold, diamonds, real stones and hallmarks', () => {
    for (const text of [
      'A real gold necklace',
      'Gold necklace set',
      'Set with diamonds',
      'Ruby and emerald stones',
      'Genuine pearls',
      'Pure brass, 22K finish',
      'Hallmarked and certified',
    ]) {
      expect(findForbiddenWording(text, 'jewellery')).not.toBeNull()
    }
  })

  it('allows the honest imitation wording', () => {
    for (const text of [
      'A gold-look polish with AD stones',
      'Antique gold-tone finish',
      'Pearl-look beads and faux pearls',
      'Ruby red and emerald green stones',
      'A diamond-look sparkle',
    ]) {
      expect(findForbiddenWording(text, 'jewellery')).toBeNull()
    }
  })

  it('does not apply the jewellery words to bangles', () => {
    expect(findForbiddenWording('Gold colour glitter bangles', 'bangles')).toBeNull()
  })
})
