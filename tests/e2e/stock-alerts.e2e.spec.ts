/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely-typed JSON responses */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startHarness, type Harness } from './harness'
import { adminToken, newCustomer } from './helpers'

let h: Harness
let token: string
beforeAll(async () => {
  h = await startHarness()
  token = await adminToken(h)
})
afterAll(async () => {
  await h?.cleanup()
})

const json = async (response: Response): Promise<any> => response.json()

describe('back-in-stock requests', () => {
  it('lets a customer wait for a sold-out option, once, and see when it is back', async () => {
    const soldOut = await h.catalog.product({
      name: 'Alert sold out',
      pricePaise: 100_000,
      stock: 0,
    })
    const { app } = await newCustomer('alert-wait', false)

    const first = await h.rest('POST', '/my-stock-alerts', {
      body: { variantId: soldOut.variantId },
      token: app.token,
    })
    expect(first.status).toBe(201)
    expect((await json(first)).data).toMatchObject({
      alreadyWaiting: false,
      variantId: soldOut.variantId,
    })

    // Tapping twice is harmless.
    const again = await h.rest('POST', '/my-stock-alerts', {
      body: { variantId: soldOut.variantId },
      token: app.token,
    })
    expect((await json(again)).data).toMatchObject({ alreadyWaiting: true })

    let list = (await json(await h.rest('GET', '/my-stock-alerts', { token: app.token }))).data.docs
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      available: false,
      productName: 'Alert sold out',
      productId: soldOut.productId,
    })

    // Staff restock it: the same alert now says it can be bought.
    const adjust = await h.rest('POST', '/admin/inventory/adjust', {
      body: { quantityDelta: 3, reason: 'manual_adjustment', variantId: soldOut.variantId },
      token,
    })
    expect(adjust.status).toBe(200)
    list = (await json(await h.rest('GET', '/my-stock-alerts', { token: app.token }))).data.docs
    expect(list[0].available).toBe(true)

    const removed = await h.rest('DELETE', `/my-stock-alerts/${soldOut.variantId}`, {
      token: app.token,
    })
    expect(removed.status).toBe(200)
    expect(
      (await json(await h.rest('GET', '/my-stock-alerts', { token: app.token }))).data.docs,
    ).toEqual([])
    expect(
      (await h.rest('DELETE', `/my-stock-alerts/${soldOut.variantId}`, { token: app.token })).status,
    ).toBe(404)
  })

  it('refuses to wait for something that is in stock or does not exist', async () => {
    const inStock = await h.catalog.product({
      name: 'Alert in stock',
      pricePaise: 100_000,
      stock: 5,
    })
    const { app } = await newCustomer('alert-refuse', false)
    const available = await h.rest('POST', '/my-stock-alerts', {
      body: { variantId: inStock.variantId },
      token: app.token,
    })
    expect(available.status).toBe(409)
    expect((await json(available)).error.code).toBe('ALREADY_AVAILABLE')
    expect(
      (
        await h.rest('POST', '/my-stock-alerts', {
          body: { variantId: 999_999_999 },
          token: app.token,
        })
      ).status,
    ).toBe(404)
    expect(
      (await h.rest('POST', '/my-stock-alerts', { body: { variantId: 'x' }, token: app.token }))
        .status,
    ).toBe(400)
  })

  it('needs a signed-in customer and keeps each customer to their own list', async () => {
    const soldOut = await h.catalog.product({
      name: 'Alert private',
      pricePaise: 100_000,
      stock: 0,
    })
    expect((await h.rest('GET', '/my-stock-alerts')).status).toBe(401)
    expect(
      (await h.rest('POST', '/my-stock-alerts', { body: { variantId: soldOut.variantId } })).status,
    ).toBe(401)

    const { app: owner } = await newCustomer('alert-owner', false)
    const { app: other } = await newCustomer('alert-other', false)
    await h.rest('POST', '/my-stock-alerts', {
      body: { variantId: soldOut.variantId },
      token: owner.token,
    })
    expect(
      (await json(await h.rest('GET', '/my-stock-alerts', { token: other.token }))).data.docs,
    ).toEqual([])
    expect(
      (await h.rest('DELETE', `/my-stock-alerts/${soldOut.variantId}`, { token: other.token })).status,
    ).toBe(404)
    expect(
      (await json(await h.rest('GET', '/my-stock-alerts', { token: owner.token }))).data.docs,
    ).toHaveLength(1)
  })
})
