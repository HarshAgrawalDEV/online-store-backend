const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const indianPhonePattern = /^(?:\+91)?[6-9]\d{9}$/
const indianPincodePattern = /^[1-9][0-9]{5}$/

export const normalizeEmail = (value: string): string => value.trim().toLowerCase()
export const normalizeCouponCode = (value: string): string => value.trim().toUpperCase()

export const validateEmail = (value: unknown): true | string =>
  (typeof value === 'string' && value.length <= 254 && emailPattern.test(value.trim())) ||
  'Enter a valid email address.'

export const validatePassword = (value: unknown): true | string => {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    return 'Password must contain 10 to 128 characters.'
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include uppercase, lowercase, and numeric characters.'
  }
  return true
}

export const normalizeIndianPhone = (value: string): string => {
  const compact = value.replace(/[\s()-]/g, '')
  if (compact.startsWith('+91')) return compact
  if (compact.startsWith('91') && compact.length === 12) return `+${compact}`
  return `+91${compact}`
}

export const validateIndianPhone = (value: unknown): true | string => {
  if (value === undefined || value === null || value === '') return true
  return (
    (typeof value === 'string' && indianPhonePattern.test(value.replace(/[\s()-]/g, ''))) ||
    'Enter a valid Indian mobile number.'
  )
}

export const validateIndianPincode = (value: unknown): true | string =>
  (typeof value === 'string' && indianPincodePattern.test(value)) ||
  'PIN code must be a valid 6-digit Indian PIN code.'

export const validateRequiredText = (
  value: unknown,
  label: string,
  maximum: number,
): true | string =>
  (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum) ||
  `${label} is required and cannot exceed ${maximum} characters.`

export const indianStateCodes = [
  'AN',
  'AP',
  'AR',
  'AS',
  'BR',
  'CH',
  'CG',
  'DH',
  'DL',
  'GA',
  'GJ',
  'HP',
  'HR',
  'JH',
  'JK',
  'KA',
  'KL',
  'LA',
  'LD',
  'MH',
  'ML',
  'MN',
  'MP',
  'MZ',
  'NL',
  'OD',
  'PB',
  'PY',
  'RJ',
  'SK',
  'TN',
  'TR',
  'TS',
  'UK',
  'UP',
  'WB',
] as const
