import type { Customer } from '../payload-types'
import type { PayloadRequest } from 'payload'

import { requireCustomer } from '../access/customers'
import { relationshipID } from '../lib/catalog'
import { MobileAPIError } from '../lib/api-response'
import {
  normalizeEmail,
  normalizeIndianPhone,
  validateEmail,
  validateIndianPhone,
  validatePassword,
  validateRequiredText,
} from '../lib/customer-validation'

const safeCustomer = (customer: Customer) => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName ?? null,
  email: customer.email,
  phoneNumber: customer.phoneNumber ?? null,
  phoneVerified: customer.phoneVerified,
  status: customer.status,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
})

const objectBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  return value as Record<string, unknown>
}

export const registerCustomer = async (req: PayloadRequest, value: unknown) => {
  const body = objectBody(value)
  const firstName = String(body.firstName ?? '').trim()
  const lastName = body.lastName == null ? undefined : String(body.lastName).trim()
  const email = normalizeEmail(String(body.email ?? ''))
  const password = body.password

  const firstNameResult = validateRequiredText(firstName, 'First name', 80)
  if (firstNameResult !== true) throw new MobileAPIError('VALIDATION_ERROR', firstNameResult)
  if (lastName && lastName.length > 80) {
    throw new MobileAPIError('VALIDATION_ERROR', 'Last name cannot exceed 80 characters.')
  }
  const emailResult = validateEmail(email)
  if (emailResult !== true) throw new MobileAPIError('VALIDATION_ERROR', emailResult)
  const passwordResult = validatePassword(password)
  if (passwordResult !== true) throw new MobileAPIError('VALIDATION_ERROR', passwordResult)

  const duplicate = await req.payload.find({
    collection: 'customers',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { email: { equals: email } },
  })
  if (duplicate.totalDocs > 0) {
    throw new MobileAPIError(
      'ACCOUNT_EXISTS',
      'An account with this email address already exists.',
      409,
    )
  }

  try {
    const customer = await req.payload.create({
      collection: 'customers',
      data: {
        email,
        firstName,
        lastName,
        password: password as string,
        phoneVerified: false,
        status: 'active',
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return safeCustomer(customer)
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 400) {
      throw new MobileAPIError('VALIDATION_ERROR', 'Unable to register with the supplied details.')
    }
    throw error
  }
}

export const updateCustomerProfile = async (req: PayloadRequest, value: unknown) => {
  const identity = requireCustomer(req)
  const body = objectBody(value)
  const allowedKeys = new Set(['firstName', 'lastName', 'phoneNumber'])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new MobileAPIError(
      'FORBIDDEN_FIELD',
      'Only firstName, lastName, and phoneNumber can be updated.',
      403,
    )
  }

  const data: { firstName?: string; lastName?: null | string; phoneNumber?: null | string } = {}
  if ('firstName' in body) {
    const firstName = String(body.firstName ?? '').trim()
    const result = validateRequiredText(firstName, 'First name', 80)
    if (result !== true) throw new MobileAPIError('VALIDATION_ERROR', result)
    data.firstName = firstName
  }
  if ('lastName' in body) {
    const lastName = body.lastName == null ? '' : String(body.lastName).trim()
    if (lastName.length > 80) {
      throw new MobileAPIError('VALIDATION_ERROR', 'Last name cannot exceed 80 characters.')
    }
    data.lastName = lastName || null
  }
  if ('phoneNumber' in body) {
    const raw = body.phoneNumber == null ? '' : String(body.phoneNumber).trim()
    const result = validateIndianPhone(raw)
    if (result !== true) throw new MobileAPIError('VALIDATION_ERROR', result)
    data.phoneNumber = raw ? normalizeIndianPhone(raw) : null
  }

  const customer = await req.payload.update({
    collection: 'customers',
    id: identity.id,
    data,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return safeCustomer(customer)
}

export const changeCustomerPassword = async (req: PayloadRequest, value: unknown) => {
  const identity = requireCustomer(req)
  const body = objectBody(value)
  const currentPassword = String(body.currentPassword ?? '')
  const newPassword = String(body.newPassword ?? '')
  const validation = validatePassword(newPassword)
  if (validation !== true) throw new MobileAPIError('VALIDATION_ERROR', validation)
  if (currentPassword === newPassword) {
    throw new MobileAPIError('VALIDATION_ERROR', 'New password must differ from current password.')
  }

  const customer = await req.payload.findByID({
    collection: 'customers',
    id: identity.id,
    depth: 0,
    overrideAccess: true,
    req,
  })
  try {
    await req.payload.login({
      collection: 'customers',
      data: { email: customer.email, password: currentPassword },
      req,
    })
  } catch {
    throw new MobileAPIError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect.', 400)
  }

  await req.payload.update({
    collection: 'customers',
    id: identity.id,
    data: { password: newPassword },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return { customerId: relationshipID(customer) }
}
