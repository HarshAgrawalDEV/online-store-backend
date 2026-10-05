/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read loosely-typed JSON responses */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setChatModelForTests } from '../../src/ai/models'
import { runTag, startHarness, type Harness } from './harness'
import { ScriptedChatModel, scriptModel } from './scripted-model'
import { adminToken, idemKey, newCustomer } from './helpers'

let h: Harness
let token: string
let productId: number
const ids = { colour: 0, material: 0, occasion: 0, sizeA: 0, sizeB: 0 }
const sizeA = `${runTag}-a`
const sizeB = `${runTag}-b`
const colourName = `E2E Rose ${runTag.slice(-4)}`
const colourCode = colourName.toLowerCase().replace(/\s+/g, '-')
const materialSlug = `${runTag}-glass`
const occasionSlug = `${runTag}-teej`

const generate = (body: Record<string, unknown>, authToken: string | undefined = token) =>
  h.rest('POST', `/admin/products/${productId}/generate-variants`, { body, token: authToken })

const json = async <T = any>(response: Response): Promise<T> => (await response.json()) as T

beforeAll(async () => {
  h = await startHarness()
  token = await adminToken(h)
  const create = async (collection: any, data: Record<string, unknown>) =>
    (await h.payload.create({ collection, data: data as never, overrideAccess: true })) as {
      id: number
    }
  ids.material = (
    await create('materials', {
      code: 'E2G',
      isActive: true,
      name: `E2E Glass ${runTag}`,
      slug: materialSlug,
    })
  ).id
  ids.sizeA = (
    await create('sizes', { code: sizeA, isActive: true, label: '2-4', sortOrder: 5 })
  ).id
  ids.sizeB = (
    await create('sizes', { code: sizeB, isActive: true, label: '2-6', sortOrder: 6 })
  ).id
  ids.colour = (
    await create('colours', { code: colourCode, isActive: true, name: colourName, sortOrder: 5 })
  ).id
  ids.occasion = (
    await create('occasions', { isActive: true, name: `E2E Teej ${runTag}`, slug: occasionSlug })
  ).id

  const category = await h.payload.find({
    collection: 'categories',
    limit: 1,
    overrideAccess: true,
    where: { slug: { equals: `${runTag}-cat` } },
  })
  const media = await h.payload.find({
    collection: 'media',
    limit: 1,
    overrideAccess: true,
    where: { alt: { equals: 'E2E placeholder' } },
  })
  productId = (
    await create('products', {
      featuredImage: media.docs[0].id,
      material: ids.material,
      name: `E2E Model Bangle ${runTag}`,
      occasions: [ids.occasion],
      primaryCategory: category.docs[0].id,
      setDetails: { kadaCount: 0, piecesTotal: 12, productType: 'bangle_set' },
      slug: `${runTag}-model`,
      status: 'draft',
    })
  ).id
})
afterAll(async () => {
  await h?.cleanup()
})

describe('set details rules', () => {
  const update = (data: Record<string, unknown>) =>
    h.payload.update({
      collection: 'products',
      data: data as never,
      id: productId,
      overrideAccess: true,
    })

  it('refuses an odd piece count and a kada pair of the wrong size', async () => {
    await expect(
      update({ setDetails: { piecesTotal: 5, productType: 'bangle_set' } }),
    ).rejects.toThrow()
    await expect(
      update({ setDetails: { kadaCount: 2, piecesTotal: 4, productType: 'kada_pair' } }),
    ).rejects.toThrow()
    await expect(
      update({ setDetails: { kadaCount: 2, piecesTotal: 2, productType: 'complete_set' } }),
    ).rejects.toThrow()
  })

  it('cannot be published without an active variant', async () => {
    await expect(update({ status: 'active' })).rejects.toThrow(/active variant/)
  })
})

describe('variant generator', () => {
  it('needs a signed-in staff member with catalog permission', async () => {
    expect(
      (await h.rest('POST', `/admin/products/${productId}/generate-variants`, { body: {} })).status,
    ).toBe(401)
    const { app } = await newCustomer('gen-customer', false)
    expect((await generate({}, app.token)).status).toBe(403)
  })

  it('rejects bad requests with a clear message', async () => {
    expect((await generate({ colours: [colourCode], sizes: [sizeA] })).status).toBe(400)
    expect(
      (await generate({ colours: [colourCode], price: 100, sizes: ['nope-size'] })).status,
    ).toBe(400)
    expect((await generate({ colours: ['nope-colour'], price: 100, sizes: [sizeA] })).status).toBe(
      400,
    )
    expect((await generate({ price: 100, sizes: [sizeA] })).status).toBe(400)
  })

  it('creates every size and colour once, with SKUs, zero stock and a saved custom colour', async () => {
    const response = await generate({
      colours: [colourCode],
      customColours: [`E2E Peacock ${runTag.slice(-4)}`],
      price: 39_900,
      saveToLibrary: true,
      sizes: [sizeA, sizeB],
    })
    expect(response.status).toBe(201)
    const body = await json(response)
    expect(body.data).toMatchObject({ createdCount: 4, skippedCount: 0 })
    for (const variant of body.data.created) {
      expect(variant.sku).toMatch(/^E2G-BNG12-\d{3}-[A-Z0-9]{1,8}-[A-Z0-9]+$/)
    }

    const variants = await h.payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: { product: { equals: productId } },
    })
    expect(variants.totalDocs).toBe(4)
    const stock = await h.payload.find({
      collection: 'inventory',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: { variant: { in: variants.docs.map((v) => v.id) } },
    })
    expect(stock.docs.every((row) => row.onHand === 0 && row.stockStatus === 'out_of_stock')).toBe(
      true,
    )

    const saved = await h.payload.find({
      collection: 'colours',
      overrideAccess: true,
      where: { code: { equals: `e2e-peacock-${runTag.slice(-4)}`.toLowerCase() } },
    })
    expect(saved.totalDocs).toBe(1)
    expect(variants.docs.every((v) => v.customColourName == null)).toBe(true)
  })

  it('is safe to repeat', async () => {
    const again = await json(
      await generate({
        colours: [colourCode],
        customColours: [`E2E Peacock ${runTag.slice(-4)}`],
        price: 39_900,
        saveToLibrary: true,
        sizes: [sizeA, sizeB],
      }),
    )
    expect(again.data).toMatchObject({ createdCount: 0, skippedCount: 4 })
  })
})

describe('prices, opening stock and size limits', () => {
  let chudaId: number

  beforeAll(async () => {
    const original = await h.payload.findByID({
      collection: 'products',
      id: productId,
      depth: 0,
      overrideAccess: true,
    })
    chudaId = (
      await h.payload.create({
        collection: 'products',
        data: {
          featuredImage:
            typeof original.featuredImage === 'object'
              ? original.featuredImage?.id
              : original.featuredImage,
          material: ids.material,
          name: `E2E Model Chuda ${runTag}`,
          primaryCategory:
            typeof original.primaryCategory === 'object'
              ? original.primaryCategory.id
              : original.primaryCategory,
          setDetails: { kadaCount: 0, piecesTotal: 10, productType: 'chuda_set' },
          slug: `${runTag}-chuda`,
          status: 'draft',
        } as never,
        overrideAccess: true,
      })
    ).id
  })

  const generateFor = (body: Record<string, unknown>) =>
    h.rest('POST', `/admin/products/${chudaId}/generate-variants`, { body, token })

  it('refuses sizes chuda is not sold in, before creating anything', async () => {
    const response = await generateFor({
      colours: [colourCode],
      price: 100_000,
      sizes: ['2-4', '2-10'],
    })
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain(
      'Chuda is only sold in sizes 2-4, 2-6, 2-8',
    )
    const count = await h.payload.count({
      collection: 'product-variants',
      overrideAccess: true,
      where: { product: { equals: chudaId } },
    })
    expect(count.totalDocs).toBe(0)
  })

  it('also refuses a wrong size created by hand in the admin', async () => {
    const wrong = await h.payload.find({
      collection: 'sizes',
      overrideAccess: true,
      where: { code: { equals: '2-10' } },
    })
    await expect(
      h.payload.create({
        collection: 'product-variants',
        data: {
          colour: ids.colour,
          pricePaise: 100_000,
          product: chudaId,
          size: wrong.docs[0].id,
          status: 'inactive',
        } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Chuda is only sold in sizes/)
  })

  it('sets one price per size and opening stock per variant', async () => {
    const response = await generateFor({
      colours: [colourCode],
      defaultStock: 2,
      price: 100_000,
      priceBySize: { '2-6': 120_000 },
      sizes: ['2-4', '2-6'],
      stock: { [`2-4|${colourCode}`]: 7 },
    })
    expect(response.status).toBe(201)
    const variants = await h.payload.find({
      collection: 'product-variants',
      depth: 0,
      overrideAccess: true,
      where: { product: { equals: chudaId } },
    })
    const price = Object.fromEntries(variants.docs.map((v) => [v.sizeCode, v.pricePaise]))
    expect(price).toEqual({ '2-4': 100_000, '2-6': 120_000 })
    const stock = await h.payload.find({
      collection: 'inventory',
      depth: 0,
      overrideAccess: true,
      where: { variant: { in: variants.docs.map((v) => v.id) } },
    })
    const bySize = Object.fromEntries(
      stock.docs.map((row) => [
        variants.docs.find((v) => v.id === row.variant)?.sizeCode,
        [row.onHand, row.stockStatus],
      ]),
    )
    expect(bySize).toEqual({ '2-4': [7, 'available'], '2-6': [2, 'available'] })
    const moves = await h.payload.count({
      collection: 'inventory-movements',
      overrideAccess: true,
      where: { variant: { in: variants.docs.map((v) => v.id) } },
    })
    expect(moves.totalDocs).toBeGreaterThan(0)
  })

  it('rejects a bad stock number', async () => {
    expect(
      (await generateFor({ colours: [colourCode], defaultStock: -1, price: 1, sizes: ['2-8'] }))
        .status,
    ).toBe(400)
  })
})

describe('catalog filters and response', () => {
  let variantId: number

  beforeAll(async () => {
    const variants = await h.payload.find({
      collection: 'product-variants',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { product: { equals: productId } },
          { sizeCode: { equals: sizeA } },
          { colorCode: { equals: colourCode } },
        ],
      },
    })
    variantId = variants.docs[0].id
    const adjust = await h.rest('POST', '/admin/inventory/adjust', {
      body: {
        operationId: idemKey('model-stock'),
        quantityDelta: 5,
        reason: 'initial_stock',
        variantId,
      },
      token,
    })
    expect(adjust.status).toBe(200)
    await h.payload.update({
      collection: 'products',
      data: { status: 'active' } as never,
      id: productId,
      overrideAccess: true,
    })
  })

  const list = async (query: string) =>
    (await json(await h.rest('GET', `/catalog/products?${query}`))).docs as any[]

  it('filters by material, colour, size and occasion', async () => {
    expect((await list(`material=${materialSlug}`)).map((p) => p.id)).toEqual([productId])
    expect((await list(`occasion=${occasionSlug}`)).map((p) => p.id)).toEqual([productId])
    expect(
      (await list(`material=${materialSlug}&colour=${colourCode}&size=${sizeB}`)).map((p) => p.id),
    ).toEqual([productId])
    expect(await list(`material=${materialSlug}&colour=no-such-colour`)).toEqual([])
    // Several values mean "either one"; unknown values are ignored when another matches.
    expect(
      (
        await list(
          `material=no-such-material,${materialSlug}&colour=${colourCode},other-colour&size=${sizeA},${sizeB}`,
        )
      ).map((p) => p.id),
    ).toEqual([productId])
    expect(await list('material=no-such-material')).toEqual([])
    expect(await list('occasion=no-such-occasion')).toEqual([])
  })

  it('searches by every word across name, colour, occasion and item code', async () => {
    const word = colourName.split(' ')[1].toLowerCase()
    expect((await list(`search=${word}`)).map((p) => p.id)).toContain(productId)
    expect((await list(`search=${word}%20bangle`)).map((p) => p.id)).toEqual([productId])
    expect((await list(`search=teej%20${word}`)).map((p) => p.id)).toEqual([productId])
    expect((await list('search=E2G-BNG12')).map((p) => p.id)).toContain(productId)
    expect(await list(`search=${word}%20zzzz`)).toEqual([])
  })

  it('returns the material, set details, sizes, colours and sorted variants', async () => {
    const [product] = await list(`material=${materialSlug}`)
    expect(product.material).toMatchObject({ slug: materialSlug })
    expect(product.setDetails).toMatchObject({
      piecesPerHand: 6,
      piecesTotal: 12,
      productType: 'bangle_set',
    })
    expect(product.occasions).toEqual([expect.objectContaining({ slug: occasionSlug })])
    expect(product.sizes.map((s: any) => s.code)).toEqual([sizeA, sizeB])
    expect(product.colours.map((c: any) => c.code)).toContain(colourCode)
    expect(product.variants[0].size.code).toBe(sizeA)
    expect(product.variants[0].costPaise).toBeUndefined()
    expect(product.aiDraft).toBeUndefined()
    expect(product.jewelryDetails.material).toBe(`E2E Glass ${runTag}`)
  })

  it('lists the filter choices at /catalog/filters', async () => {
    const body = await json(await h.rest('GET', '/catalog/filters'))
    const data = body.data ?? body
    expect(data.materials.map((m: any) => m.slug)).toContain(materialSlug)
    expect(data.sizes.map((s: any) => s.code)).toContain(sizeA)
    expect(data.colours.map((c: any) => c.code)).toContain(colourCode)
    expect(data.occasions.map((o: any) => o.slug)).toContain(occasionSlug)
    expect(data.priceRange.minPaise).toBeLessThanOrEqual(39_900)
  })

  it('keeps a readable description on the order item', async () => {
    const { address, app } = await newCustomer('model-order')
    await app.addToCart(variantId, 1, productId)
    await h.setShipping({
      codEnabled: true,
      codFeePaise: 0,
      freeShippingAbovePaise: 0,
      standardFeePaise: 0,
    })
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('model-order'),
    )
    const items = await h.payload.find({
      collection: 'order-items',
      depth: 0,
      overrideAccess: true,
      where: { order: { equals: Number(placed.order.id) } },
    })
    expect(items.docs[0].descriptionSnapshot).toBe(
      `E2E Glass ${runTag} · 12-piece bangle set · Size 2-4 · ${colourName}`,
    )
  })
})

describe('description draft', () => {
  const call = (action: string, authToken: string | undefined = token) =>
    h.rest('POST', `/admin/products/${productId}/${action}`, { token: authToken })
  const product = () =>
    h.payload.findByID({ collection: 'products', id: productId, overrideAccess: true })

  it('is switched off without a key', async () => {
    const saved = process.env.GROQ_API_KEY
    delete process.env.GROQ_API_KEY
    try {
      expect((await call('generate-description')).status).toBe(503)
    } finally {
      if (saved !== undefined) process.env.GROQ_API_KEY = saved
    }
  })

  it('names an unsupported AI provider instead of guessing', async () => {
    process.env.AI_PROVIDER = 'not-a-provider'
    try {
      const response = await call('generate-description')
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).toContain('not supported')
    } finally {
      delete process.env.AI_PROVIDER
    }
  })

  it('saves a draft but leaves the real description alone, then applies it on request', async () => {
    const { model, restore } = scriptModel([
      'Teal glass bangles for Teej.\n\nSold as a set of twelve.',
    ])
    try {
      const response = await call('generate-description')
      expect(response.status).toBe(200)
      expect(model.sent(0)).toContain('12-piece bangle set')
      const saved = await product()
      expect(saved.aiDraft?.text).toContain('Teal glass bangles')
      expect(saved.aiDraft?.model).toBeTruthy()
      expect(saved.description).toBeFalsy()

      expect((await call('apply-description-draft')).status).toBe(200)
      expect(JSON.stringify((await product()).description)).toContain('Sold as a set of twelve.')
    } finally {
      restore()
    }
  })

  it('sends the product wording rules and retries when the wrong word is used', async () => {
    const { model, restore } = scriptModel([
      'Each kada sparkles.',
      'Twelve glass bangles that sparkle.',
    ])
    try {
      expect((await call('generate-description')).status).toBe(200)
      expect(model.calls).toHaveLength(2)
      expect(model.sent(0)).toContain('Never use the words kada or chuda')
      expect(model.sent(1)).toContain('which is the wrong word for this product')
      expect((await product()).aiDraft?.text).toBe('Twelve glass bangles that sparkle.')
    } finally {
      restore()
    }
  })

  it('passes staff thoughts and the earlier draft when asking for another version', async () => {
    const { model, restore } = scriptModel(['A shorter note for Teej.'])
    try {
      const response = await h.rest('POST', `/admin/products/${productId}/generate-description`, {
        body: {
          instructions: 'make it shorter and mention Teej',
          previousDraft: 'The long first draft.',
        },
        token,
      })
      expect(response.status).toBe(200)
      expect(model.sent(0)).toContain('Staff request: make it shorter and mention Teej')
      expect(model.sent(0)).toContain('The long first draft.')
    } finally {
      restore()
    }
  })

  it('refuses a draft that claims ivory', async () => {
    const { restore } = scriptModel(['Beautiful real ivory chuda.'])
    try {
      expect((await call('generate-description')).status).toBe(422)
    } finally {
      restore()
    }
  })

  it('turns a provider failure into a plain message', async () => {
    class FailingModel extends ScriptedChatModel {
      async _generate(): Promise<never> {
        throw Object.assign(new Error('401 invalid api key'), { status: 401 })
      }
    }
    setChatModelForTests(new FailingModel([]))
    try {
      const response = await call('generate-description')
      expect(response.status).toBe(502)
      expect(JSON.stringify(await response.json())).toContain('key is not valid')
    } finally {
      setChatModelForTests(undefined)
    }
  })

  it('is for staff only', async () => {
    const { app } = await newCustomer('draft-customer', false)
    expect((await call('generate-description', app.token)).status).toBe(403)
  })
})
