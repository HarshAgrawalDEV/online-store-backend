/**
 * What a product physically is: a pair of kadas, a bangle set, a complete set or a chuda set.
 * Every item is sold for both hands, so the piece count is always even.
 */
export const productTypes = ['kada_pair', 'bangle_set', 'complete_set', 'chuda_set'] as const
export type ProductType = (typeof productTypes)[number]

export const productTypeLabels: Record<ProductType, string> = {
  kada_pair: 'Kada pair',
  bangle_set: 'Bangle set',
  complete_set: 'Complete set',
  chuda_set: 'Chuda set',
}

export type SetDetails = {
  kadaCount?: null | number
  piecesTotal?: null | number
  productType?: null | ProductType
}

const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

export const piecesPerHand = (piecesTotal: number): number => piecesTotal / 2

/**
 * Returns a message when the combination is impossible, otherwise undefined.
 * Unset values are allowed (a draft may be incomplete); use `isSetDetailsComplete` to require them.
 */
export const validateSetDetails = ({
  kadaCount,
  piecesTotal,
  productType,
}: SetDetails): string | undefined => {
  if (piecesTotal != null) {
    if (!isWholeNumber(piecesTotal) || piecesTotal < 2)
      return 'Total pieces must be a whole number of at least 2.'
    if (piecesTotal % 2 !== 0)
      return 'Total pieces must be even because every set is sold for both hands.'
  }
  if (kadaCount != null) {
    if (!isWholeNumber(kadaCount) || kadaCount < 0)
      return 'Kada count must be a whole number, zero or more.'
    if (piecesTotal != null && kadaCount > piecesTotal)
      return 'Kada count cannot exceed the total pieces.'
  }
  switch (productType) {
    case 'kada_pair':
      if (piecesTotal != null && piecesTotal !== 2)
        return 'A kada pair always has exactly 2 pieces.'
      if (kadaCount != null && kadaCount !== 2) return 'A kada pair always has 2 kadas.'
      break
    case 'complete_set':
      if (kadaCount != null && kadaCount !== 2)
        return 'A complete set has 2 kadas (one for each hand).'
      if (piecesTotal != null && piecesTotal < 4)
        return 'A complete set needs at least 2 kadas and 2 bangles.'
      break
    case 'bangle_set':
    case 'chuda_set':
      if (kadaCount != null && kadaCount !== 0) return 'Bangle and chuda sets contain no kadas.'
      break
    default:
      break
  }
  return undefined
}

/** True when everything needed to sell the product is present. */
export const isSetDetailsComplete = (details: SetDetails): boolean =>
  Boolean(details.productType) &&
  isWholeNumber(details.piecesTotal) &&
  (details.productType !== 'complete_set' || isWholeNumber(details.kadaCount))

/** Normalised view used in API responses; kada pair and complete set kadas are implied. */
export const resolveSetDetails = (details: SetDetails) => {
  if (!details.productType || !isWholeNumber(details.piecesTotal)) return null
  const kadaCount =
    details.productType === 'kada_pair' || details.productType === 'complete_set'
      ? 2
      : (details.kadaCount ?? 0)
  return {
    bangleCount: details.piecesTotal - kadaCount,
    kadaCount,
    piecesPerHand: piecesPerHand(details.piecesTotal),
    piecesTotal: details.piecesTotal,
    productType: details.productType,
  }
}

/** Short human description of the set, for example "Chuda · 5 per hand (10 pcs)". */
export const describeSet = (details: SetDetails): string => {
  const resolved = resolveSetDetails(details)
  if (!resolved) return ''
  switch (resolved.productType) {
    case 'kada_pair':
      return 'Kada pair'
    case 'complete_set':
      return `Complete set (${resolved.kadaCount} kadas + ${resolved.bangleCount} bangles)`
    case 'chuda_set':
      return `Chuda · ${resolved.piecesPerHand} per hand (${resolved.piecesTotal} pcs)`
    default:
      return `${resolved.piecesTotal}-piece bangle set`
  }
}

/** One line for order paperwork, for example "Boor · Chuda · 5 per hand (10 pcs) · 2-6 · Rani". */
export const describeVariantLine = ({
  colourName,
  materialName,
  sizeLabel,
  ...details
}: SetDetails & {
  colourName?: null | string
  materialName?: null | string
  sizeLabel?: null | string
}): string =>
  [materialName, describeSet(details), sizeLabel ? `Size ${sizeLabel}` : '', colourName]
    .filter(Boolean)
    .join(' · ')

const alnum = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Product-type part of a SKU. Chuda uses the per-hand count; everything else the total count. */
export const skuTypeCode = (productType: ProductType, piecesTotal: number): string => {
  switch (productType) {
    case 'kada_pair':
      return 'KDP'
    case 'complete_set':
      return `CMP${piecesTotal}`
    case 'chuda_set':
      return `CHD${piecesPerHand(piecesTotal)}`
    default:
      return `BNG${piecesTotal}`
  }
}

/**
 * Simple descriptive SKU: material - type+pieces - design number - colour - size,
 * for example GLS-BNG12-014-TEAL-24 or BOR-CHD5-007-RANI-26.
 */
export const buildSku = ({
  colourShortCode,
  designNumber,
  materialCode,
  piecesTotal,
  productType,
  sizeCode,
}: {
  colourShortCode?: null | string
  designNumber?: null | number
  materialCode?: null | string
  piecesTotal?: null | number
  productType?: null | ProductType
  sizeCode?: null | string
}): string =>
  [
    materialCode ? alnum(materialCode) : '',
    productType && isWholeNumber(piecesTotal) ? skuTypeCode(productType, piecesTotal) : '',
    designNumber != null ? String(designNumber).padStart(3, '0') : '',
    colourShortCode ? alnum(colourShortCode).slice(0, 8) : '',
    sizeCode ? alnum(sizeCode) : '',
  ]
    .filter(Boolean)
    .join('-')

/** Fallback short colour code taken from the colour name when none was entered. */
export const shortCodeFromName = (name: string): string => alnum(name).slice(0, 6)

/** Sizes a product type is sold in. Chuda only comes in three; everything else may use any size. */
const CHUDA_SIZES = ['2-4', '2-6', '2-8'] as const

export const allowedSizeCodes = (productType?: null | string): readonly string[] | undefined =>
  productType === 'chuda_set' ? CHUDA_SIZES : undefined

/** Plain-language message when a size is not offered for the product type, otherwise undefined. */
export const sizeNotAllowedMessage = (
  productType: null | string | undefined,
  sizeCode: null | string | undefined,
): string | undefined => {
  const allowed = allowedSizeCodes(productType)
  if (!allowed || !sizeCode || allowed.includes(sizeCode)) return undefined
  return `Chuda is only sold in sizes ${allowed.join(', ')}. Size ${sizeCode} is not available for it.`
}
