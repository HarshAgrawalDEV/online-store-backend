import type { CustomerAddress } from '../payload-types'
import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'

import { requireCustomer } from '../access/customers'
import { MobileAPIError } from '../lib/api-response'
import {
  indianStateCodes,
  normalizeIndianPhone,
  validateIndianPhone,
  validateIndianPincode,
  validateRequiredText,
} from '../lib/customer-validation'

type AddressInput = {
  addressType: 'home' | 'other' | 'work'
  city: string
  countryCode: 'IN'
  isDefault: boolean
  landmark?: string
  line1: string
  line2?: string
  phoneNumber: string
  pincode: string
  recipientName: string
  stateCode: (typeof indianStateCodes)[number]
}

const parseAddress = (value: unknown, partial = false): Partial<AddressInput> => {
  if (!value || typeof value !== 'object') {
    throw new MobileAPIError('VALIDATION_ERROR', 'A JSON body is required.')
  }
  const body = value as Record<string, unknown>
  const allowed = new Set([
    'recipientName',
    'phoneNumber',
    'line1',
    'line2',
    'landmark',
    'city',
    'stateCode',
    'pincode',
    'countryCode',
    'addressType',
    'isDefault',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new MobileAPIError('FORBIDDEN_FIELD', 'Address contains unsupported fields.', 403)
  }

  const required = ['recipientName', 'phoneNumber', 'line1', 'city', 'stateCode', 'pincode']
  if (!partial && required.some((key) => body[key] === undefined)) {
    throw new MobileAPIError('VALIDATION_ERROR', 'Required address fields are missing.')
  }
  const result: Partial<AddressInput> = {}
  for (const [key, max] of [
    ['recipientName', 120],
    ['line1', 180],
    ['city', 100],
  ] as const) {
    if (key in body) {
      const text = String(body[key] ?? '').trim()
      const validation = validateRequiredText(text, key, max)
      if (validation !== true) throw new MobileAPIError('VALIDATION_ERROR', validation)
      result[key] = text
    }
  }
  for (const [key, max] of [
    ['line2', 180],
    ['landmark', 140],
  ] as const) {
    if (key in body) {
      const text = String(body[key] ?? '').trim()
      if (text.length > max) {
        throw new MobileAPIError('VALIDATION_ERROR', `${key} cannot exceed ${max} characters.`)
      }
      result[key] = text || undefined
    }
  }
  if ('phoneNumber' in body) {
    const phone = String(body.phoneNumber ?? '')
    const validation = validateIndianPhone(phone)
    if (validation !== true || !phone) {
      throw new MobileAPIError(
        'VALIDATION_ERROR',
        String(validation === true ? 'Phone is required.' : validation),
      )
    }
    result.phoneNumber = normalizeIndianPhone(phone)
  }
  if ('pincode' in body) {
    const pincode = String(body.pincode ?? '').trim()
    const validation = validateIndianPincode(pincode)
    if (validation !== true) throw new MobileAPIError('VALIDATION_ERROR', validation)
    result.pincode = pincode
  }
  if ('stateCode' in body) {
    const stateCode = String(body.stateCode ?? '').toUpperCase()
    if (!indianStateCodes.includes(stateCode as AddressInput['stateCode'])) {
      throw new MobileAPIError(
        'VALIDATION_ERROR',
        'Use a valid Indian state or union territory code.',
      )
    }
    result.stateCode = stateCode as AddressInput['stateCode']
  }
  if ('countryCode' in body && body.countryCode !== 'IN') {
    throw new MobileAPIError('VALIDATION_ERROR', 'Only Indian addresses are supported currently.')
  }
  if ('countryCode' in body) result.countryCode = 'IN'
  if ('addressType' in body) {
    if (!['home', 'work', 'other'].includes(String(body.addressType))) {
      throw new MobileAPIError('VALIDATION_ERROR', 'addressType must be home, work, or other.')
    }
    result.addressType = body.addressType as AddressInput['addressType']
  }
  if ('isDefault' in body) {
    if (typeof body.isDefault !== 'boolean') {
      throw new MobileAPIError('VALIDATION_ERROR', 'isDefault must be a boolean.')
    }
    result.isDefault = body.isDefault
  }
  return result
}

const findOwnedAddress = async (req: PayloadRequest, id: number): Promise<CustomerAddress> => {
  const customer = requireCustomer(req)
  const result = await req.payload.find({
    collection: 'customer-addresses',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: {
      and: [
        { id: { equals: id } },
        { customer: { equals: customer.id } },
        { isActive: { equals: true } },
      ],
    },
  })
  if (!result.docs[0]) throw new MobileAPIError('NOT_FOUND', 'Address not found.', 404)
  return result.docs[0]
}

const unsetDefaults = async (req: PayloadRequest, customerID: number | string) => {
  await req.payload.update({
    collection: 'customer-addresses',
    data: { isDefault: false },
    depth: 0,
    overrideAccess: true,
    req,
    where: { and: [{ customer: { equals: customerID } }, { isDefault: { equals: true } }] },
  })
}

const transaction = async <T>(req: PayloadRequest, operation: () => Promise<T>): Promise<T> => {
  const started = await initTransaction(req)
  try {
    const result = await operation()
    if (started) await commitTransaction(req)
    return result
  } catch (error) {
    if (started) await killTransaction(req)
    throw error
  }
}

export const listAddresses = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  return req.payload.find({
    collection: 'customer-addresses',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    req,
    sort: '-isDefault',
    where: { and: [{ customer: { equals: customer.id } }, { isActive: { equals: true } }] },
  })
}

export const createAddress = async (req: PayloadRequest, value: unknown) => {
  requireCustomer(req)
  const customer = requireCustomer(req)
  const input = parseAddress(value) as AddressInput
  return transaction(req, async () => {
    const count = await req.payload.count({
      collection: 'customer-addresses',
      overrideAccess: true,
      req,
      where: { and: [{ customer: { equals: customer.id } }, { isActive: { equals: true } }] },
    })
    const makeDefault = input.isDefault || count.totalDocs === 0
    if (makeDefault) await unsetDefaults(req, customer.id)
    return req.payload.create({
      collection: 'customer-addresses',
      data: {
        ...input,
        countryCode: 'IN',
        customer: customer.id as number,
        isActive: true,
        isDefault: makeDefault,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  })
}

export const updateAddress = async (req: PayloadRequest, id: number, value: unknown) => {
  requireCustomer(req)
  const customer = requireCustomer(req)
  await findOwnedAddress(req, id)
  const input = parseAddress(value, true)
  return transaction(req, async () => {
    if (input.isDefault) await unsetDefaults(req, customer.id)
    return req.payload.update({
      collection: 'customer-addresses',
      id,
      data: input,
      depth: 0,
      overrideAccess: true,
      req,
    })
  })
}

export const deleteAddress = async (req: PayloadRequest, id: number) => {
  const customer = requireCustomer(req)
  const address = await findOwnedAddress(req, id)
  return transaction(req, async () => {
    await req.payload.update({
      collection: 'customer-addresses',
      id,
      data: { isActive: false, isDefault: false },
      depth: 0,
      overrideAccess: true,
      req,
    })
    if (address.isDefault) {
      const replacement = await req.payload.find({
        collection: 'customer-addresses',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        sort: '-updatedAt',
        where: {
          and: [
            { customer: { equals: customer.id } },
            { isActive: { equals: true } },
            { id: { not_equals: id } },
          ],
        },
      })
      if (replacement.docs[0]) {
        await req.payload.update({
          collection: 'customer-addresses',
          id: replacement.docs[0].id,
          data: { isDefault: true },
          depth: 0,
          overrideAccess: true,
          req,
        })
      }
    }
    return { id, deleted: true }
  })
}

export const setDefaultAddress = async (req: PayloadRequest, id: number) => {
  const customer = requireCustomer(req)
  await findOwnedAddress(req, id)
  return transaction(req, async () => {
    await unsetDefaults(req, customer.id)
    return req.payload.update({
      collection: 'customer-addresses',
      id,
      data: { isDefault: true },
      depth: 0,
      overrideAccess: true,
      req,
    })
  })
}

export const getDefaultAddress = async (req: PayloadRequest) => {
  const customer = requireCustomer(req)
  const result = await req.payload.find({
    collection: 'customer-addresses',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: {
      and: [
        { customer: { equals: customer.id } },
        { isActive: { equals: true } },
        { isDefault: { equals: true } },
      ],
    },
  })
  return result.docs[0] ?? null
}

export const parseRouteID = (req: PayloadRequest, key = 'id'): number => {
  const value = Number(req.routeParams?.[key])
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MobileAPIError('VALIDATION_ERROR', `${key} must be a positive integer.`)
  }
  return value
}
