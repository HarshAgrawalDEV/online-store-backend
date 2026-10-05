import 'dotenv/config'

import { fileURLToPath } from 'node:url'

import { getPayload, type CollectionSlug, type Payload } from 'payload'

import config from '../payload.config'
import type { Category, Collection as CuratedCollection, Media, Product } from '../payload-types'

const findBy = async (
  payload: Payload,
  collection: CollectionSlug,
  field: string,
  value: unknown,
) =>
  payload.find({
    collection,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { [field]: { equals: value } },
  })

const ensureCategory = async (
  payload: Payload,
  data: {
    department?: 'bangles' | 'jewellery'
    description: string
    name: string
    parent?: number
    skuCode?: string
    slug: string
    sortOrder: number
  },
): Promise<Category> => {
  const existing = await findBy(payload, 'categories', 'slug', data.slug)
  if (existing.docs[0]) return existing.docs[0] as Category
  return payload.create({
    collection: 'categories',
    data: { department: 'bangles', ...data, isActive: true },
  })
}

const ensureCollection = async (
  payload: Payload,
  data: {
    occasion: 'everyday' | 'festive' | 'gifting' | 'wedding'
    slug: string
    sortOrder: number
    summary: string
    title: string
  },
): Promise<CuratedCollection> => {
  const existing = await findBy(payload, 'collections', 'slug', data.slug)
  if (existing.docs[0]) {
    return payload.update({
      collection: 'collections',
      id: existing.docs[0].id,
      data: { ...data, isPublished: true },
    })
  }
  return payload.create({
    collection: 'collections',
    data: { ...data, isPublished: true },
  })
}

type LibraryCollection =
  | 'colours'
  | 'finishes'
  | 'jewellery-styles'
  | 'materials'
  | 'occasions'
  | 'piece-types'
  | 'sizes'
  | 'stone-types'

/** Creates a library entry the first time; later runs leave staff edits alone. */
const ensureLibrary = async (
  payload: Payload,
  collection: LibraryCollection,
  field: string,
  data: Record<string, unknown>,
): Promise<{ id: number }> => {
  const existing = await findBy(payload, collection, field, data[field])
  if (existing.docs[0]) return existing.docs[0] as { id: number }
  return (await payload.create({
    collection,
    data: { isActive: true, ...data } as never,
    overrideAccess: true,
  })) as { id: number }
}

const ensureMedia = async (payload: Payload): Promise<Media> => {
  const filename = 'jewelry-placeholder.svg'
  const existing = await findBy(payload, 'media', 'filename', filename)
  if (existing.docs[0]) return existing.docs[0] as Media

  return payload.create({
    collection: 'media',
    data: {
      alt: 'Decorative Rajasthan jewelry placeholder',
      caption: 'Seed catalog placeholder image',
      kind: 'product',
    },
    filePath: fileURLToPath(new URL('./assets/jewelry-placeholder.svg', import.meta.url)),
  })
}

type SeedVariantGroup = {
  colours: string[]
  /** Price per size code, in paise. */
  prices: Record<string, number>
  stock: number
}

type SeedProduct = {
  category: string
  collections: string[]
  material: 'boor' | 'glass' | 'lakh' | 'seep'
  name: string
  occasions: string[]
  piecesTotal: number
  kadaCount: number
  productType: 'bangle_set' | 'chuda_set' | 'complete_set' | 'kada_pair'
  slug: string
  shortDescription: string
  variants: SeedVariantGroup
}

const productSeeds: SeedProduct[] = [
  {
    category: 'bangles',
    collections: ['bridal-bangles', 'wedding-guest'],
    kadaCount: 0,
    material: 'glass',
    name: 'Teal Sparkle Glass Bangle Set',
    occasions: ['wedding-season', 'teej', 'daily-wear'],
    piecesTotal: 12,
    productType: 'bangle_set',
    shortDescription: 'Twelve glass bangles, six for each hand, with a sparkling finish.',
    slug: 'teal-sparkle-glass-bangle-set',
    variants: {
      colours: ['teal', 'rani'],
      prices: { '2-4': 39900, '2-6': 39900, '2-8': 42900 },
      stock: 12,
    },
  },
  {
    category: 'kadas',
    collections: ['festive-jewelry', 'jaipur-edit'],
    kadaCount: 2,
    material: 'lakh',
    name: 'Red Green Lakh Kada Pair',
    occasions: ['teej', 'gangaur', 'karwa-chauth'],
    piecesTotal: 2,
    productType: 'kada_pair',
    shortDescription: 'A pair of handmade lakh kadas, one for each hand.',
    slug: 'red-green-lakh-kada-pair',
    variants: {
      colours: ['red-green', 'multicolour'],
      prices: { '2-4': 79900, '2-6': 79900, '2-8': 84900 },
      stock: 8,
    },
  },
  {
    category: 'complete-sets',
    collections: ['bridal-bangles', 'wedding-guest'],
    kadaCount: 2,
    material: 'glass',
    name: 'Maroon Glass Complete Set',
    occasions: ['wedding-season', 'karwa-chauth'],
    piecesTotal: 6,
    productType: 'complete_set',
    shortDescription: 'Two kadas and four bangles, made to be worn together.',
    slug: 'maroon-glass-complete-set',
    variants: {
      colours: ['maroon', 'red'],
      prices: { '2-4': 129900, '2-6': 129900, '2-8': 139900 },
      stock: 6,
    },
  },
  {
    category: 'chuda',
    collections: ['bridal-bangles', 'wedding-guest'],
    kadaCount: 0,
    material: 'boor',
    name: 'Rani Boor Chuda 5 per Hand',
    occasions: ['wedding-season'],
    piecesTotal: 10,
    productType: 'chuda_set',
    shortDescription: 'Boor chuda with five bangles for each hand, sold as a pair.',
    slug: 'rani-boor-chuda-5-per-hand',
    variants: {
      colours: ['rani', 'maroon', 'ivory'],
      prices: { '2-4': 249900, '2-6': 249900, '2-8': 259900 },
      stock: 5,
    },
  },
]

const seedSizes: Array<[string, string, number | undefined, number]> = [
  ['2-2', '2-2', 54, 10],
  ['2-4', '2-4', 57.2, 20],
  ['2-6', '2-6', 60.3, 30],
  ['2-8', '2-8', 63.5, 40],
  ['2-10', '2-10', 66.7, 50],
  ['2-12', '2-12', 70, 60],
]

const seedColours: Array<[string, string, string, number]> = [
  ['Ivory', '#F3EBDD', 'Boor in ivory or cream.', 10],
  ['Cream', '#F6EEDA', '', 15],
  ['Chiku', '#C9A66B', 'Pale yellow-brown; the shade varies slightly between batches.', 20],
  ['Red', '#B3122B', '', 30],
  ['Maroon', '#6F1D2A', '', 40],
  ['Rani', '#C2185B', 'Dark pink.', 50],
  ['Teal', '#127C7C', '', 60],
  ['Green', '#1F7A4C', '', 70],
  ['Yellow', '#E0B01E', '', 80],
  ['Red Green', '#7C5A1E', 'Red and green together.', 90],
  ['Multicolour', '#8E4FA8', '', 100],
]

const seedOccasions = [
  'Wedding Season',
  'Teej',
  'Karwa Chauth',
  'Gangaur',
  'Navratri',
  'Diwali',
  'Holi',
  'Raksha Bandhan',
  'Eid',
  'Daily Wear',
]

type JewellerySeed = {
  category: string
  colours: string[]
  components: Array<[string, number]>
  finish: string
  name: string
  occasions: string[]
  pricePaise: number
  shortDescription: string
  slug: string
  stock: number
  stones: string[]
  styles: string[]
  wear?: 'both' | 'clip_on' | 'pierced'
}

const jewelleryPieces: Array<[string, boolean]> = [
  ['Necklace', false],
  ['Earrings', true],
  ['Ear chain', true],
  ['Maang tikka', false],
  ['Rakhdi', false],
  ['Sheeshphool', false],
  ['Nath', false],
  ['Besar', false],
  ['Bajuband', true],
  ['Loom', false],
  ['Hathphool', false],
  ['Bracelet', false],
  ['Bangdi', true],
  ['Ring', false],
  ['Anklet', true],
]
const jewelleryStyleNames = [
  'Traditional',
  'Fancy',
  'Kundan-look',
  'Polki-look',
  'Jadau-look',
  'Meenakari',
  'Temple',
  'Pearl',
  'Oxidised',
  'Beaded',
]
const finishNames = [
  'Gold-look polish',
  'Micro polish (gold-look)',
  'Matte gold-look',
  'Antique gold-look',
  'Rose gold-look',
  'Silver-look',
  'Oxidised',
]
const stoneNames = [
  'AD / CZ stones',
  'Kundan-look stones',
  'Polki-look stones',
  'Pearl-look beads',
  'Beads',
  'Crystals',
  'Enamel (meenakari)',
]
const jewelleryCategories: Array<[string, string, string, string]> = [
  ['Necklace Sets', 'necklace-sets', 'NKS', 'Necklaces sold with matching earrings.'],
  ['Necklaces', 'necklaces', 'NCK', 'Necklaces and chokers on their own.'],
  ['Earrings', 'earrings', 'ERG', 'Jhumka, chandbali, studs and danglers.'],
  ['Head Ornaments', 'head-ornaments', 'HDO', 'Maang tikka, rakhdi and sheeshphool.'],
  ['Nose Ornaments', 'nose-ornaments', 'NSO', 'Nath and besar.'],
  ['Armlets', 'armlets', 'ARM', 'Bajuband and loom.'],
  ['Bracelets & Hathphool', 'bracelets-hathphool', 'BRC', 'Bracelets, bangdi and hathphool.'],
  ['Bridal Sets', 'bridal-sets', 'BRD', 'Full sets with several parts.'],
]

// Development sample products only: the photos, prices and names are placeholders.
const jewellerySeeds: JewellerySeed[] = [
  {
    category: 'necklace-sets',
    colours: ['rani', 'maroon', 'green'],
    components: [
      ['Necklace', 1],
      ['Earrings', 1],
    ],
    finish: 'Antique gold-look',
    name: 'Sample Pearl Choker Set',
    occasions: ['wedding-season', 'karwa-chauth'],
    pricePaise: 189900,
    shortDescription: 'A pearl-look choker with matching earrings.',
    slug: 'sample-pearl-choker-set',
    stock: 6,
    stones: ['AD / CZ stones', 'Pearl-look beads'],
    styles: ['Traditional', 'Pearl'],
  },
  {
    category: 'necklace-sets',
    colours: ['red'],
    components: [
      ['Necklace', 1],
      ['Earrings', 1],
    ],
    finish: 'Micro polish (gold-look)',
    name: 'Sample Hasli Style Necklace Set',
    occasions: ['daily-wear', 'wedding-season'],
    pricePaise: 129900,
    shortDescription: 'A gold-look collar necklace with matching earrings.',
    slug: 'sample-hasli-style-necklace-set',
    stock: 8,
    stones: ['AD / CZ stones'],
    styles: ['Fancy'],
  },
  {
    category: 'earrings',
    colours: ['rani', 'green'],
    components: [
      ['Earrings', 1],
      ['Ear chain', 1],
    ],
    finish: 'Gold-look polish',
    name: 'Sample Chandbali Earrings with Ear Chain',
    occasions: ['wedding-season', 'navratri'],
    pricePaise: 69900,
    shortDescription: 'Chandbali earrings with pearl-look drops and ear chains.',
    slug: 'sample-chandbali-earrings-ear-chain',
    stock: 10,
    stones: ['Kundan-look stones', 'Pearl-look beads'],
    styles: ['Kundan-look', 'Traditional'],
    wear: 'pierced',
  },
  {
    category: 'armlets',
    colours: ['maroon'],
    components: [['Bajuband', 1]],
    finish: 'Antique gold-look',
    name: 'Sample Rajputi Bajuband',
    occasions: ['wedding-season', 'gangaur'],
    pricePaise: 89900,
    shortDescription: 'A pair of adjustable Rajputi bajuband.',
    slug: 'sample-rajputi-bajuband',
    stock: 5,
    stones: ['Kundan-look stones'],
    styles: ['Traditional', 'Jadau-look'],
  },
]

const seedJewellery = async (payload: Payload, mediaID: number, colourIDs: Map<string, number>) => {
  const idsByName = async (
    collection: 'finishes' | 'jewellery-styles' | 'piece-types' | 'stone-types',
    names: string[],
    extra: (name: string, index: number) => Record<string, unknown> = () => ({}),
  ) => {
    const ids = new Map<string, number>()
    let order = 10
    for (const [index, name] of names.entries()) {
      const row = await ensureLibrary(payload, collection, 'name', {
        name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        sortOrder: order,
        ...extra(name, index),
      })
      ids.set(name, row.id)
      order += 10
    }
    return ids
  }
  const pieces = await idsByName(
    'piece-types',
    jewelleryPieces.map(([name]) => name),
    (_name, index) => ({ soldAsPair: jewelleryPieces[index][1] }),
  )
  const styles = await idsByName('jewellery-styles', jewelleryStyleNames)
  const finishes = await idsByName('finishes', finishNames)
  const stones = await idsByName('stone-types', stoneNames)

  const categories = new Map<string, Category>()
  let order = 110
  for (const [name, slug, skuCode, description] of jewelleryCategories) {
    categories.set(
      slug,
      await ensureCategory(payload, {
        department: 'jewellery',
        description,
        name,
        skuCode,
        slug,
        sortOrder: order,
      }),
    )
    order += 10
  }

  const occasionIDs = new Map<string, number>()
  for (const slug of ['wedding-season', 'karwa-chauth', 'daily-wear', 'gangaur', 'navratri']) {
    const found = await findBy(payload, 'occasions', 'slug', slug)
    if (found.docs[0]) occasionIDs.set(slug, found.docs[0].id)
  }

  for (const item of jewellerySeeds) {
    const category = categories.get(item.category)
    if (!category) throw new Error(`Missing jewellery category ${item.category}.`)
    const existing = await findBy(payload, 'products', 'slug', item.slug)
    const product =
      (existing.docs[0] as Product | undefined) ??
      (await payload.create({
        collection: 'products',
        data: {
          department: 'jewellery',
          featuredImage: mediaID,
          gallery: [{ caption: item.name, image: mediaID, sortOrder: 0 }],
          isReturnable: true,
          jewellery: {
            baseMetal: 'brass',
            components: item.components.map(([name, quantity]) => ({
              piece: pieces.get(name) as number,
              quantity,
            })),
            finish: finishes.get(item.finish),
            fit: 'adjustable',
            stoneTypes: item.stones.map((name) => stones.get(name) as number),
            styles: item.styles.map((name) => styles.get(name) as number),
            wear: item.wear,
          },
          name: item.name,
          occasions: item.occasions
            .map((slug) => occasionIDs.get(slug))
            .filter((id): id is number => id !== undefined),
          primaryCategory: category.id,
          shortDescription: item.shortDescription,
          slug: item.slug,
          status: 'draft',
        } as never,
      }))

    for (const colourCode of item.colours) {
      const present = await payload.count({
        collection: 'product-variants',
        overrideAccess: true,
        where: {
          and: [{ product: { equals: product.id } }, { colorCode: { equals: colourCode } }],
        },
      })
      if (present.totalDocs > 0) continue
      const variant = await payload.create({
        collection: 'product-variants',
        data: {
          colour: colourIDs.get(colourCode),
          image: mediaID,
          maxPerOrder: 3,
          pricePaise: item.pricePaise,
          product: product.id,
          status: 'active',
        } as never,
      })
      await payload.create({
        collection: 'inventory',
        context: {
          inventoryAdjustment: { note: 'Development seed stock', reason: 'initial_stock' },
        },
        data: {
          onHand: item.stock,
          reserved: 0,
          reorderPoint: Math.min(2, item.stock),
          stockStatus: 'available',
          variant: variant.id,
        },
        overrideAccess: true,
      })
    }
    await payload.update({ collection: 'products', id: product.id, data: { status: 'active' } })
  }
}

const seed = async () => {
  const payload = await getPayload({ config })
  payload.logger.info('Starting development catalog and shopping seed')

  const media = await ensureMedia(payload)

  const materialIDs = new Map<string, number>()
  for (const [name, slug, code, isPremium, sortOrder] of [
    ['Glass', 'glass', 'GLS', false, 10],
    ['Lakh', 'lakh', 'LAK', false, 20],
    ['Boor', 'boor', 'BOR', true, 30],
    ['Seep', 'seep', 'SEP', true, 40],
  ] as const) {
    const material = await ensureLibrary(payload, 'materials', 'code', {
      code,
      isPremium,
      name,
      slug,
      sortOrder,
    })
    materialIDs.set(slug, material.id)
  }

  const sizeIDs = new Map<string, number>()
  for (const [code, label, innerDiameterMm, sortOrder] of seedSizes) {
    const size = await ensureLibrary(payload, 'sizes', 'code', {
      code,
      innerDiameterMm,
      label,
      sortOrder,
    })
    sizeIDs.set(code, size.id)
  }

  const colourIDs = new Map<string, number>()
  for (const [name, swatchHex, note, sortOrder] of seedColours) {
    const code = name.toLowerCase().replace(/\s+/g, '-')
    const colour = await ensureLibrary(payload, 'colours', 'code', {
      code,
      name,
      note: note || undefined,
      sortOrder,
      swatchHex,
    })
    colourIDs.set(code, colour.id)
  }

  const occasionIDs = new Map<string, number>()
  let occasionOrder = 10
  for (const name of seedOccasions) {
    const slug = name.toLowerCase().replace(/\s+/g, '-')
    const occasion = await ensureLibrary(payload, 'occasions', 'slug', {
      name,
      slug,
      sortOrder: occasionOrder,
    })
    occasionIDs.set(slug, occasion.id)
    occasionOrder += 10
  }

  const categoryList = [
    await ensureCategory(payload, {
      description: 'Glass and lakh bangle sets.',
      name: 'Bangles',
      slug: 'bangles',
      sortOrder: 10,
    }),
    await ensureCategory(payload, {
      description: 'Kadas, always sold as a pair.',
      name: 'Kadas',
      slug: 'kadas',
      sortOrder: 20,
    }),
    await ensureCategory(payload, {
      description: 'Two kadas and four bangles, together.',
      name: 'Complete Sets',
      slug: 'complete-sets',
      sortOrder: 30,
    }),
    await ensureCategory(payload, {
      description: 'Boor and seep chuda for brides.',
      name: 'Chuda',
      slug: 'chuda',
      sortOrder: 40,
    }),
  ]
  const categories = new Map(categoryList.map((item) => [item.slug, item]))

  const collectionData = [
    ['The Jaipur Edit', 'jaipur-edit', 'A colorful edit inspired by the Pink City.', 'festive', 10],
    [
      'Wedding Guest',
      'wedding-guest',
      'Celebration-ready pieces for wedding guests.',
      'wedding',
      20,
    ],
    ['Festive Jewelry', 'festive-jewelry', 'Pieces for Indian festivals.', 'festive', 40],
    ['Bridal Bangles', 'bridal-bangles', 'Bridal bangles, kadas and chuda.', 'wedding', 50],
  ] as const
  const collectionList = []
  for (const [title, slug, summary, occasion, sortOrder] of collectionData) {
    collectionList.push(
      await ensureCollection(payload, { title, slug, summary, occasion, sortOrder }),
    )
  }
  const collections = new Map(collectionList.map((item) => [item.slug, item]))

  for (const item of productSeeds) {
    const category = categories.get(item.category)
    const productCollections = item.collections.map((slug) => collections.get(slug)?.id)
    if (!category || productCollections.some((id) => id === undefined)) {
      throw new Error(`Seed relationships are missing for ${item.slug}.`)
    }

    const existingProduct = await findBy(payload, 'products', 'slug', item.slug)
    const existingDocument = existingProduct.docs[0] as Product | undefined
    // The design number is assigned once, on creation; reruns only top up what is missing.
    const product =
      existingDocument ??
      (await payload.create({
        collection: 'products',
        data: {
          department: 'bangles',
          categories: [category.id],
          collections: productCollections as number[],
          featuredImage: media.id,
          gallery: [{ caption: item.name, image: media.id, sortOrder: 0 }],
          isFeatured: item.productType === 'chuda_set',
          isReturnable: true,
          material: materialIDs.get(item.material),
          name: item.name,
          occasions: item.occasions.map((slug) => occasionIDs.get(slug) as number),
          primaryCategory: category.id,
          setDetails: {
            kadaCount: item.kadaCount,
            piecesTotal: item.piecesTotal,
            productType: item.productType,
          },
          shortDescription: item.shortDescription,
          slug: item.slug,
          status: 'draft',
          styleTags: [{ label: 'Rajasthani' }],
          taxClass: 'standard',
        },
      }))

    for (const colourCode of item.variants.colours) {
      for (const [sizeCode, pricePaise] of Object.entries(item.variants.prices)) {
        const present = await payload.count({
          collection: 'product-variants',
          overrideAccess: true,
          where: {
            and: [
              { product: { equals: product.id } },
              { sizeCode: { equals: sizeCode } },
              { colorCode: { equals: colourCode } },
            ],
          },
        })
        if (present.totalDocs > 0) continue

        // The SKU is generated from the design number, material, type, colour and size.
        const variant = await payload.create({
          collection: 'product-variants',
          data: {
            colour: colourIDs.get(colourCode),
            image: media.id,
            maxPerOrder: 5,
            pricePaise,
            product: product.id,
            size: sizeIDs.get(sizeCode),
            status: 'active',
          } as never,
        })
        await payload.create({
          collection: 'inventory',
          context: {
            inventoryAdjustment: { note: 'Development seed stock', reason: 'initial_stock' },
          },
          data: {
            onHand: item.variants.stock,
            reserved: 0,
            reorderPoint: Math.min(3, item.variants.stock),
            stockStatus: 'available',
            variant: variant.id,
          },
          overrideAccess: true,
        })
      }
    }

    await payload.update({ collection: 'products', id: product.id, data: { status: 'active' } })
  }

  await seedJewellery(payload, media.id, colourIDs)

  const existingPromotion = await findBy(payload, 'promotions', 'name', 'Welcome Offer')
  const promotionData = {
    description: 'Ten percent off eligible development carts.',
    discountType: 'percentage' as const,
    discountValue: 10,
    maxDiscountPaise: 50000,
    name: 'Welcome Offer',
    status: 'active' as const,
  }
  const promotion = existingPromotion.docs[0]
    ? await payload.update({
        collection: 'promotions',
        id: existingPromotion.docs[0].id,
        data: promotionData,
      })
    : await payload.create({ collection: 'promotions', data: promotionData })

  const existingCoupon = await findBy(payload, 'coupons', 'code', 'WELCOME10')
  const couponData = {
    code: 'WELCOME10',
    description: 'Development coupon: 10% off carts of ₹1,000 or more.',
    minimumCartPaise: 100000,
    perCustomerLimit: 1,
    promotion: promotion.id,
    status: 'active' as const,
    usageLimit: 1000,
  }
  if (existingCoupon.docs[0]) {
    await payload.update({
      collection: 'coupons',
      id: existingCoupon.docs[0].id,
      data: couponData,
    })
  } else {
    await payload.create({ collection: 'coupons', data: couponData })
  }

  payload.logger.info('Development catalog and shopping seed complete')
  await payload.destroy()
}

await seed()
process.exit(0)
