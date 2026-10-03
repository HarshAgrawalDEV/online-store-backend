import { describe, expect, it } from 'vitest'

import { CatalogQueryError, parseCatalogFilters } from '@/services/catalog-query'
import { InventoryAdjustmentError, parseInventoryAdjustment } from '@/services/inventory'

describe('catalog query validation', () => {
  it('normalizes supported filters and prices in paise', () => {
    expect(
      parseCatalogFilters(
        'http://localhost/api/catalog/products?page=2&limit=12&minPrice=10000&maxPrice=250000&available=true&color=Ruby-Red&sort=price-low',
      ),
    ).toMatchObject({
      available: true,
      color: 'ruby-red',
      limit: 12,
      maxPrice: 250000,
      minPrice: 10000,
      page: 2,
      sort: 'price-low',
    })
  })

  it.each([
    'http://localhost/api/catalog/products?limit=51',
    'http://localhost/api/catalog/products?minPrice=200&maxPrice=100',
    'http://localhost/api/catalog/products?available=yes',
    'http://localhost/api/catalog/products?sort=popular',
  ])('rejects an invalid query: %s', (url) => {
    expect(() => parseCatalogFilters(url)).toThrow(CatalogQueryError)
  })
})

describe('inventory adjustment validation', () => {
  it('accepts integer stock deltas', () => {
    expect(
      parseInventoryAdjustment({
        note: 'Cycle count',
        quantityDelta: -2,
        reason: 'manual_adjustment',
        variantId: 12,
      }),
    ).toEqual({
      note: 'Cycle count',
      quantityDelta: -2,
      reason: 'manual_adjustment',
      variantID: 12,
    })
  })

  it.each([
    { quantityDelta: 0, variantId: 1 },
    { quantityDelta: 1.5, variantId: 1 },
    { quantityDelta: 1, variantId: 0 },
    { quantityDelta: 1, reason: 'order_fulfilled', variantId: 1 },
  ])('rejects an unsafe adjustment: %j', (body) => {
    expect(() => parseInventoryAdjustment(body)).toThrow(InventoryAdjustmentError)
  })
})
