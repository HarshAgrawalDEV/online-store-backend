export const toSlug = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const relationshipID = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined

  const id = (value as { id?: unknown }).id
  return typeof id === 'number' || typeof id === 'string' ? id : undefined
}

export const isNonNegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const isPositiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const validateOptionalNonNegativeInteger = (value: unknown): true | string => {
  if (value === undefined || value === null) return true
  return isNonNegativeInteger(value) || 'Value must be a non-negative whole number.'
}

export const validateRequiredNonNegativeInteger = (value: unknown): true | string =>
  isNonNegativeInteger(value) || 'Value must be a non-negative whole number.'

export const validateRequiredPositiveInteger = (value: unknown): true | string =>
  isPositiveInteger(value) || 'Value must be a positive whole number.'

export const validateOptionalHexColor = (value: unknown): true | string => {
  if (value === undefined || value === null || value === '') return true
  return (typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value)) || 'Use #RRGGBB.'
}

export const normalizeCode = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
