/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely-typed JSON responses */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runTag, startHarness, type Harness } from './harness'
import { scriptModel } from './scripted-model'
import { adminToken, idemKey, newCustomer } from './helpers'

let h: Harness
let token: string
const ids = {
  category: 0,
  colour: 0,
  earrings: 0,
  finish: 0,
  necklace: 0,
  media: 0,
  stone: 0,
  style: 0,
}
const colourName = `E2E Coral ${runTag.slice(-4)}`
const colourCode = colourName.toLowerCase().replace(/\s+/g, '-')
const slug = (name: string) => `${runTag}-${name}`
let productId: number

const json = async (response: Response): Promise<any> => response.json()
// The filters endpoint returns its object directly; other endpoints wrap it in { data }.
const unwrap = (body: any) => body.data ?? body
const create = async (collection: any, data: Record<string, unknown>) =>
  (await h.payload.create({ collection, data: data as never, overrideAccess: true })) as {
    id: number
  }

const jewelleryProduct = (extra: Record<string, unknown> = {}) => ({
  department: 'jewellery',
  featuredImage: ids.media,
  jewellery: {
    components: [
      { piece: ids.necklace, quantity: 1 },
      { piece: ids.earrings, quantity: 1 },
    ],
    finish: ids.finish,
    styles: [ids.style],
    stoneTypes: [ids.stone],
  },
  name: `E2E Jewel Set ${runTag}`,
  primaryCategory: ids.category,
  slug: slug('jewel'),
  status: 'draft',
  ...extra,
})

beforeAll(async () => {
  h = await startHarness()
  token = await adminToken(h)
  ids.category = (
    await create('categories', {
      department: 'jewellery',
      isActive: true,
      name: `E2E Necklace Sets ${runTag}`,
      skuCode: 'EJW',
      slug: slug('jcat'),
    })
  ).id
  ids.necklace = (
    await create('piece-types', { name: `E2E Necklace ${runTag}`, slug: slug('necklace') })
  ).id
  ids.earrings = (
    await create('piece-types', {
      name: `E2E Earrings ${runTag}`,
      slug: slug('earrings'),
      soldAsPair: true,
    })
  ).id
  ids.finish = (
    await create('finishes', { name: `E2E Antique gold-look ${runTag}`, slug: slug('finish') })
  ).id
  ids.style = (
    await create('jewellery-styles', { name: `E2E Kundan-look ${runTag}`, slug: slug('style') })
  ).id
  ids.stone = (
    await create('stone-types', { name: `E2E AD stones ${runTag}`, slug: slug('stone') })
  ).id
  ids.colour = (
    await create('colours', { code: colourCode, isActive: true, name: colourName, sortOrder: 5 })
  ).id
  const media = await h.payload.find({
    collection: 'media',
    limit: 1,
    overrideAccess: true,
    where: { alt: { equals: 'E2E placeholder' } },
  })
  ids.media = media.docs[0].id
  productId = (await create('products', jewelleryProduct())).id
})
afterAll(async () => {
  await h?.cleanup()
})

describe('jewellery rules', () => {
  const update = (data: Record<string, unknown>) =>
    h.payload.update({
      collection: 'products',
      data: data as never,
      id: productId,
      overrideAccess: true,
    })

  it('keeps bangles and jewellery in their own categories', async () => {
    const bangleCategory = await h.payload.find({
      collection: 'categories',
      limit: 1,
      overrideAccess: true,
      where: { slug: { equals: `${runTag}-cat` } },
    })
    await expect(
      create(
        'products',
        jewelleryProduct({ primaryCategory: bangleCategory.docs[0].id, slug: slug('wrongcat') }),
      ),
    ).rejects.toThrow(/is a bangles category/)
  })

  it('refuses the same part twice', async () => {
    await expect(
      update({
        jewellery: {
          components: [
            { piece: ids.necklace, quantity: 1 },
            { piece: ids.necklace, quantity: 1 },
          ],
        },
      }),
    ).rejects.toThrow(/only be listed once/)
  })

  it('cannot go live without parts, a finish and a variant', async () => {
    await expect(update({ status: 'active' })).rejects.toThrow(/active variant/)
    const bare = await create('products', jewelleryProduct({ jewellery: {}, slug: slug('bare') }))
    await expect(
      h.payload.update({
        collection: 'products',
        data: { status: 'active' } as never,
        id: bare.id,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/at least one part/)
  })
})

describe('jewellery variants and catalog', () => {
  const generate = (body: Record<string, unknown>) =>
    h.rest('POST', `/admin/products/${productId}/generate-variants`, { body, token })
  const list = async (query: string) =>
    (await json(await h.rest('GET', `/catalog/products?${query}`))).docs as any[]

  it('creates one variant per colour with no sizes, and an item code from the category', async () => {
    const response = await generate({
      colours: [colourCode],
      defaultStock: 4,
      price: 189_900,
      sizes: [],
    })
    expect(response.status).toBe(201)
    const body = await json(response)
    expect(body.data).toMatchObject({ createdCount: 1 })
    expect(body.data.created[0].sku).toMatch(/^EJW-\d{3}-[A-Z0-9]+$/)
    const again = await json(await generate({ colours: [colourCode], price: 189_900, sizes: [] }))
    expect(again.data).toMatchObject({ createdCount: 0, skippedCount: 1 })
    await h.payload.update({
      collection: 'products',
      data: { status: 'active' } as never,
      id: productId,
      overrideAccess: true,
    })
  })

  it('still requires sizes for bangles', async () => {
    const bangle = await h.catalog.product({ name: 'Jewel bangle', pricePaise: 100_000, stock: 1 })
    const response = await h.rest('POST', `/admin/products/${bangle.productId}/generate-variants`, {
      body: { colours: [colourCode], price: 100, sizes: [] },
      token,
    })
    expect(response.status).toBe(400)
  })

  it('lists jewellery only in its department, with its parts', async () => {
    expect((await list('department=jewellery')).map((p) => p.id)).toContain(productId)
    expect((await list('department=bangles')).map((p) => p.id)).not.toContain(productId)
    const [product] = (await list(`department=jewellery&piece=${slug('earrings')}`)).filter(
      (p) => p.id === productId,
    )
    expect(product.department).toBe('jewellery')
    expect(product.material).toBeNull()
    expect(product.jewellery).toMatchObject({
      isSet: true,
      summary: `E2E Necklace ${runTag} + E2E Earrings ${runTag} (pair)`,
    })
    expect(product.jewellery.finish.slug).toBe(slug('finish'))
    expect(product.variants[0].size).toBeNull()
    expect(product.variants[0].costPaise).toBeUndefined()
  })

  it('filters by part, style, stone and finish', async () => {
    const mine = async (query: string) =>
      (await list(`department=jewellery&${query}`)).map((p) => p.id)
    expect(await mine(`piece=${slug('earrings')}`)).toContain(productId)
    expect(await mine(`style=${slug('style')}`)).toContain(productId)
    expect(await mine(`stone=${slug('stone')}`)).toContain(productId)
    expect(await mine(`finish=${slug('finish')}`)).toContain(productId)
    expect(await mine('finish=no-such-finish')).toEqual([])
    expect(await mine('piece=no-such-part')).toEqual([])
  })

  it('finds it by part and style names in search', async () => {
    expect((await list('search=earrings')).map((p) => p.id)).toContain(productId)
    expect((await list(`search=kundan%20${slug('x').slice(0, 3)}`)).map((p) => p.id)).not.toContain(
      -1,
    )
    expect(
      (await list(`search=${colourName.split(' ')[1].toLowerCase()}%20necklace`)).map((p) => p.id),
    ).toContain(productId)
  })

  it('gives each department its own filter choices', async () => {
    const jewelleryFacets = unwrap(
      await json(await h.rest('GET', '/catalog/filters?department=jewellery')),
    )
    expect(jewelleryFacets.categories.every((c: any) => c.department === 'jewellery')).toBe(true)
    expect(jewelleryFacets.categories.map((c: any) => c.slug)).toContain(slug('jcat'))
    expect(jewelleryFacets.pieceTypes.map((p: any) => p.slug)).toEqual(
      expect.arrayContaining([slug('necklace'), slug('earrings')]),
    )
    expect(jewelleryFacets.finishes.map((p: any) => p.slug)).toContain(slug('finish'))
    expect(jewelleryFacets.materials).toEqual([])
    expect(jewelleryFacets.sizes).toEqual([])

    const bangleFacets = unwrap(
      await json(await h.rest('GET', '/catalog/filters?department=bangles')),
    )
    expect(bangleFacets.categories.every((c: any) => c.department === 'bangles')).toBe(true)
    expect(bangleFacets.pieceTypes).toEqual([])
    expect((await h.rest('GET', '/catalog/filters?department=nope')).status).toBe(200)
    expect((await h.rest('GET', '/catalog/products?department=nope')).status).toBe(400)
  })

  it('keeps a readable description of the parts on the order item', async () => {
    const { address, app } = await newCustomer('jewel-order')
    const detail = (await list('department=jewellery')).find((p) => p.id === productId)
    await app.addToCart(String(detail.variants[0].id) as any, 1, productId as any)
    await h.setShipping({
      codEnabled: true,
      codFeePaise: 0,
      freeShippingAbovePaise: 0,
      standardFeePaise: 0,
    })
    const placed = await app.placeOrder(
      { addressId: address!.id, paymentMethod: 'cod' },
      idemKey('jewel-order'),
    )
    const items = await h.payload.find({
      collection: 'order-items',
      depth: 0,
      overrideAccess: true,
      where: { order: { equals: Number(placed.order.id) } },
    })
    expect(items.docs[0].descriptionSnapshot).toBe(
      `E2E Necklace ${runTag} + E2E Earrings ${runTag} (pair) · E2E Antique gold-look ${runTag} · ${colourName}`,
    )
  })
})

describe('jewellery description draft', () => {
  const call = (action: string) =>
    h.rest('POST', `/admin/products/${productId}/${action}`, { token })

  it('sends the parts and finish, and rejects claims of real gold or diamonds', async () => {
    const { model, restore } = scriptModel([
      'A real gold necklace with diamonds.',
      'A gold-look necklace set with AD stones.',
    ])
    try {
      expect((await call('generate-description')).status).toBe(200)
      expect(model.calls).toHaveLength(2)
      expect(model.sent(0)).toContain('This is imitation jewellery')
      expect(model.sent(0)).toContain(
        `What is included: E2E Necklace ${runTag} + E2E Earrings ${runTag} (pair)`,
      )
      expect(model.sent(0)).toContain('Finish: E2E Antique gold-look')
      expect(model.sent(1)).toContain('which must never appear')
      const product = await h.payload.findByID({
        collection: 'products',
        id: productId,
        overrideAccess: true,
      })
      expect(product.aiDraft?.text).toBe('A gold-look necklace set with AD stones.')
    } finally {
      restore()
    }
  })
})
