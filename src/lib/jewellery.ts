/**
 * Jewellery is a separate department from bangles. A bangle product is described by how many pieces
 * and for which hands; a jewellery product by the parts it contains (necklace, earrings, tikka...).
 */
export const departments = ['bangles', 'jewellery'] as const
export type Department = (typeof departments)[number]

export const departmentLabels: Record<Department, string> = {
  bangles: 'Bangles',
  jewellery: 'Jewellery',
}

export const wearOptions = [
  { label: 'Pierced', value: 'pierced' },
  { label: 'Clip-on (no piercing)', value: 'clip_on' },
  { label: 'Pierced or clip-on', value: 'both' },
] as const

export const fitOptions = [
  { label: 'Adjustable (dori / hook)', value: 'adjustable' },
  { label: 'Fixed size', value: 'fixed' },
] as const

export const baseMetals = [
  { label: 'Brass', value: 'brass' },
  { label: 'Copper', value: 'copper' },
  { label: 'Mixed alloy', value: 'alloy' },
  { label: 'Other', value: 'other' },
] as const

export type JewelleryComponent = {
  name: string
  quantity: number
  soldAsPair?: boolean
}

const MAX_COMPONENTS = 12

/** Rules for the parts of a jewellery product. Returns a plain-language message, or undefined when fine. */
export const validateJewelleryComponents = (
  components: Array<{ piece?: unknown; quantity?: null | number }> | null | undefined,
): string | undefined => {
  const list = components ?? []
  if (list.length > MAX_COMPONENTS) return `A set can have at most ${MAX_COMPONENTS} parts.`
  const seen = new Set<string>()
  for (const entry of list) {
    const id = String(
      typeof entry.piece === 'object' && entry.piece
        ? (entry.piece as { id?: unknown }).id
        : entry.piece,
    )
    if (entry.piece && seen.has(id))
      return 'Each part can only be listed once. Raise its quantity instead.'
    if (entry.piece) seen.add(id)
    const quantity = Number(entry.quantity ?? 1)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return 'Each part needs a quantity between 1 and 10.'
    }
  }
  return undefined
}

/** "Necklace + Earrings (pair) + Maang tikka". Pairs are written once; other quantities as "× 2". */
export const describeComponents = (components: JewelleryComponent[]): string =>
  components
    .map(({ name, quantity, soldAsPair }) => {
      if (soldAsPair) return `${name} (pair)`
      return quantity > 1 ? `${name} × ${quantity}` : name
    })
    .join(' + ')

export const isJewellerySet = (components: JewelleryComponent[]): boolean => components.length > 1

/** One line for order paperwork, e.g. "Necklace + Earrings (pair) · Antique gold-look · Pink". */
export const describeJewelleryLine = ({
  colourName,
  components,
  finishName,
  sizeLabel,
}: {
  colourName?: null | string
  components: JewelleryComponent[]
  finishName?: null | string
  sizeLabel?: null | string
}): string =>
  [describeComponents(components), finishName, sizeLabel ? `Size ${sizeLabel}` : '', colourName]
    .filter(Boolean)
    .join(' · ')

const alnum = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** NKS-014-PINK, or NKS-014-PINK-26 when the design also comes in sizes. */
export const buildJewellerySku = ({
  categoryCode,
  colourShortCode,
  designNumber,
  sizeCode,
}: {
  categoryCode?: null | string
  colourShortCode?: null | string
  designNumber?: null | number
  sizeCode?: null | string
}): string =>
  [
    categoryCode ? alnum(categoryCode).slice(0, 4) : 'JWL',
    designNumber ? String(designNumber).padStart(3, '0') : '',
    colourShortCode ? alnum(colourShortCode).slice(0, 8) : '',
    sizeCode ? alnum(sizeCode) : '',
  ]
    .filter(Boolean)
    .join('-')
