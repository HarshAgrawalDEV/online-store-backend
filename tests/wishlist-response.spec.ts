import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { listWishlist } from '@/services/wishlist'

/**
 * Regression test for the privileged-read leak: the wishlist response must contain only the
 * allow-listed fields, never raw documents, and catalog data must be read with access rules on.
 */
describe('wishlist response', () => {
  const find = vi.fn(
    async ({ collection, overrideAccess }: { collection: string; overrideAccess?: boolean }) => {
      switch (collection) {
        case 'wishlists':
          return { docs: [{ id: 3 }] }
        case 'wishlist-items':
          return {
            docs: [
              { createdAt: '2026-10-03T10:00:00Z', id: 11, product: 7, wishlist: 3 },
              { createdAt: '2026-10-03T09:00:00Z', id: 12, product: 8, wishlist: 3 },
            ],
            hasNextPage: false,
            limit: 20,
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }
        case 'products':
          // Only product 7 is still active; its raw document carries internal fields.
          expect(overrideAccess).toBe(false)
          return {
            docs: [
              {
                featuredImage: {
                  sizes: { card: { url: '/api/media/file/a-card.jpg' } },
                  url: '/api/media/file/a.jpg',
                },
                hsnCode: '7117',
                id: 7,
                internalNotes: 'supplier: Acme',
                name: 'Royal Kundan Bangle',
                primaryCategory: { id: 1, name: 'Bangles' },
                shortDescription: 'Antique gold',
                slug: 'royal-kundan-bangle',
                status: 'active',
              },
            ],
          }
        case 'product-variants':
          expect(overrideAccess).toBe(false)
          return {
            docs: [
              { costPaise: 90_000, id: 21, pricePaise: 250_000, product: 7, sku: 'RK-24' },
              { costPaise: 80_000, id: 22, pricePaise: 200_000, product: 7, sku: 'RK-26' },
            ],
          }
        case 'inventory':
          return {
            docs: [
              { onHand: 5, reserved: 5, stockStatus: 'available', variant: 21 },
              { onHand: 5, reserved: 1, stockStatus: 'available', variant: 22 },
            ],
          }
        default:
          throw new Error(`unexpected collection ${collection}`)
      }
    },
  )

  const req = {
    payload: { find, create: vi.fn() },
    url: 'http://localhost/api/wishlist?page=1&limit=20',
    user: { collection: 'customers', id: 1, status: 'active' },
  } as unknown as PayloadRequest

  it('returns only allow-listed fields and omits inactive products', async () => {
    const result = await listWishlist(req)
    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toEqual({
      addedAt: '2026-10-03T10:00:00Z',
      id: 11,
      product: {
        available: true,
        category: 'Bangles',
        id: 7,
        imageUrl: '/api/media/file/a-card.jpg',
        name: 'Royal Kundan Bangle',
        priceRange: { maxPaise: 250_000, minPaise: 200_000 },
        shortDescription: 'Antique gold',
        slug: 'royal-kundan-bangle',
      },
      productId: 7,
    })
  })

  it('never leaks cost prices, internal notes or tax codes anywhere in the payload', async () => {
    const serialized = JSON.stringify(await listWishlist(req))
    for (const secret of ['costPaise', '90000', 'internalNotes', 'supplier', 'hsnCode', 'sku']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('reads the catalog with access rules enabled', async () => {
    find.mockClear()
    await listWishlist(req)
    const catalogReads = find.mock.calls.filter(([args]) =>
      ['products', 'product-variants'].includes(args.collection),
    )
    expect(catalogReads).toHaveLength(2)
    for (const [args] of catalogReads) expect(args.overrideAccess).toBe(false)
  })
})
