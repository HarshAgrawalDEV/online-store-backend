import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emailFor, password, startHarness, type Harness } from './harness'
import { MobileApp } from './mobile'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(async () => {
  await h?.cleanup()
})

describe('harness smoke test', () => {
  it('lets the mobile app register, sign in and browse a product', async () => {
    const product = await h.catalog.product({ name: 'Smoke Bangle', pricePaise: 150000, stock: 3 })
    const app = new MobileApp(emailFor('smoke'), password)
    const profile = await app.register('Smoke')
    expect(profile.email).toBe(app.email)
    const found = await app.products({ search: 'Smoke Bangle' })
    expect(found.map((p) => p.name)).toContain('Smoke Bangle')
    expect((await app.product(product.productId)).variants[0]).toMatchObject({
      available: true,
      quantity: 3,
    })
  })
})
