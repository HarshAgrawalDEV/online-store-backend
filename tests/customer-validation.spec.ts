import { describe, expect, it } from 'vitest'

import { isActiveCustomer } from '@/access/customers'
import {
  normalizeCouponCode,
  normalizeIndianPhone,
  validateEmail,
  validateIndianPhone,
  validateIndianPincode,
  validatePassword,
} from '@/lib/customer-validation'
import { calculateDiscountPaise } from '@/services/pricing'

describe('customer authentication validation', () => {
  it('accepts strong passwords and rejects weak passwords', () => {
    expect(validatePassword('Jewelry2026Secure')).toBe(true)
    expect(validatePassword('password')).not.toBe(true)
    expect(validatePassword('NOLOWERCASE123')).not.toBe(true)
  })

  it('validates email, Indian phones, and PIN codes', () => {
    expect(validateEmail('customer@example.com')).toBe(true)
    expect(validateEmail('invalid-email')).not.toBe(true)
    expect(validateIndianPhone('98765 43210')).toBe(true)
    expect(normalizeIndianPhone('98765 43210')).toBe('+919876543210')
    expect(validateIndianPincode('302001')).toBe(true)
    expect(validateIndianPincode('012345')).not.toBe(true)
  })

  it('separates active customers from admins and suspended customers', () => {
    expect(isActiveCustomer({ collection: 'customers', id: 1, status: 'active' })).toBe(true)
    expect(isActiveCustomer({ collection: 'customers', id: 1, status: 'suspended' })).toBe(false)
    expect(isActiveCustomer({ collection: 'admins', id: 1, status: 'active' })).toBe(false)
  })
})

describe('cart pricing', () => {
  it('calculates integer percentage discounts and applies a cap', () => {
    expect(
      calculateDiscountPaise({
        discountType: 'percentage',
        discountValue: 15,
        eligibleSubtotalPaise: 259800,
        maxDiscountPaise: 30000,
        subtotalPaise: 259800,
      }),
    ).toBe(30000)
  })

  it('never discounts more than the eligible subtotal or cart subtotal', () => {
    expect(
      calculateDiscountPaise({
        discountType: 'fixed',
        discountValue: 500000,
        eligibleSubtotalPaise: 120000,
        subtotalPaise: 200000,
      }),
    ).toBe(120000)
  })

  it('normalizes coupon codes', () => {
    expect(normalizeCouponCode(' festive10 ')).toBe('FESTIVE10')
  })
})
