import 'dotenv/config'

import { fileURLToPath } from 'node:url'

import { getPayload, type CollectionSlug, type Payload } from 'payload'

import config from '../payload.config'
import type {
  CatalogAttributeDefinition,
  CatalogAttributeOption,
  Category,
  Collection as CuratedCollection,
  Media,
  Product,
  ProductVariant,
} from '../payload-types'

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
  data: { description: string; name: string; parent?: number; slug: string; sortOrder: number },
): Promise<Category> => {
  const existing = await findBy(payload, 'categories', 'slug', data.slug)
  if (existing.docs[0]) return existing.docs[0] as Category
  return payload.create({ collection: 'categories', data: { ...data, isActive: true } })
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

const ensureAttributeDefinition = async (
  payload: Payload,
  data: { code: string; name: string; sortOrder: number },
): Promise<CatalogAttributeDefinition> => {
  const existing = await findBy(payload, 'catalog-attribute-definitions', 'code', data.code)
  if (existing.docs[0]) return existing.docs[0] as CatalogAttributeDefinition
  return payload.create({
    collection: 'catalog-attribute-definitions',
    data: { ...data, filterable: true, scope: 'variant', valueType: 'select' },
  })
}

const ensureAttributeOption = async (
  payload: Payload,
  attribute: number,
  data: { code: string; label: string; sortOrder: number; swatchHex?: string },
): Promise<CatalogAttributeOption> => {
  const existing = await payload.find({
    collection: 'catalog-attribute-options',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ attribute: { equals: attribute } }, { code: { equals: data.code } }] },
  })
  if (existing.docs[0]) return existing.docs[0] as CatalogAttributeOption
  return payload.create({
    collection: 'catalog-attribute-options',
    data: { ...data, attribute, isActive: true },
  })
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

type SeedProduct = {
  category: string
  collections: string[]
  colorCode: string
  material: string
  name: string
  occasion: 'everyday' | 'festive' | 'gifting' | 'wedding'
  plating: string
  pricePaise: number
  sku: string
  slug: string
  stoneType: string
  stock: number
}

const productSeeds: SeedProduct[] = [
  {
    category: 'bangles',
    collections: ['bridal-bangles', 'wedding-guest'],
    colorCode: 'ruby-red',
    material: 'Brass',
    name: 'Rajputana Ruby Bridal Bangles',
    occasion: 'wedding',
    plating: 'Antique Gold',
    pricePaise: 349900,
    sku: 'RJ-BNG-RUBY-24',
    slug: 'rajputana-ruby-bridal-bangles',
    stoneType: 'Kundan and imitation ruby',
    stock: 18,
  },
  {
    category: 'jhumkas',
    collections: ['jaipur-edit', 'festive-jewelry'],
    colorCode: 'emerald-green',
    material: 'Brass',
    name: 'Jaipur Meenakari Jhumkas',
    occasion: 'festive',
    plating: '22K Gold Tone',
    pricePaise: 189900,
    sku: 'RJ-JHM-MEENA-GRN',
    slug: 'jaipur-meenakari-jhumkas',
    stoneType: 'Pearl and enamel',
    stock: 31,
  },
  {
    category: 'necklaces',
    collections: ['wedding-guest', 'festive-jewelry'],
    colorCode: 'pearl-white',
    material: 'Alloy',
    name: 'Sheesh Mahal Kundan Necklace',
    occasion: 'wedding',
    plating: 'Gold Tone',
    pricePaise: 599900,
    sku: 'RJ-NCK-SHEESH-01',
    slug: 'sheesh-mahal-kundan-necklace',
    stoneType: 'Kundan and faux pearl',
    stock: 12,
  },
  {
    category: 'earrings',
    collections: ['everyday-elegance', 'gifting-edit'],
    colorCode: 'gold',
    material: 'Sterling Silver',
    name: 'Desert Bloom Stud Earrings',
    occasion: 'everyday',
    plating: '18K Gold Vermeil',
    pricePaise: 149900,
    sku: 'RJ-ERN-BLOOM-01',
    slug: 'desert-bloom-stud-earrings',
    stoneType: 'Cubic zirconia',
    stock: 45,
  },
  {
    category: 'bridal-sets',
    collections: ['bridal-bangles', 'jaipur-edit'],
    colorCode: 'maroon',
    material: 'Brass',
    name: 'Maharani Polki Bridal Set',
    occasion: 'wedding',
    plating: 'Antique Gold',
    pricePaise: 1299900,
    sku: 'RJ-BRD-MAHARANI-01',
    slug: 'maharani-polki-bridal-set',
    stoneType: 'Polki, kundan and faux pearl',
    stock: 6,
  },
]

const seed = async () => {
  const payload = await getPayload({ config })
  payload.logger.info('Starting development catalog and shopping seed')

  const media = await ensureMedia(payload)
  const categoryList = [
    await ensureCategory(payload, {
      description: 'Traditional and contemporary bangle sets.',
      name: 'Bangles',
      slug: 'bangles',
      sortOrder: 10,
    }),
    await ensureCategory(payload, {
      description: 'Statement and everyday earrings.',
      name: 'Earrings',
      slug: 'earrings',
      sortOrder: 20,
    }),
    await ensureCategory(payload, {
      description: 'Necklaces inspired by Rajasthan craftsmanship.',
      name: 'Necklaces',
      slug: 'necklaces',
      sortOrder: 30,
    }),
    await ensureCategory(payload, {
      description: 'Coordinated jewelry sets for bridal celebrations.',
      name: 'Bridal Sets',
      slug: 'bridal-sets',
      sortOrder: 40,
    }),
  ]
  const earrings = categoryList.find(({ slug }) => slug === 'earrings')
  if (!earrings) throw new Error('Earrings seed category was not created.')
  categoryList.push(
    await ensureCategory(payload, {
      description: 'Classic bell-shaped earrings.',
      name: 'Jhumkas',
      parent: earrings.id,
      slug: 'jhumkas',
      sortOrder: 21,
    }),
  )
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
    [
      'Everyday Elegance',
      'everyday-elegance',
      'Lightweight jewelry for daily wear.',
      'everyday',
      30,
    ],
    ['Festive Jewelry', 'festive-jewelry', 'Statement pieces for Indian festivals.', 'festive', 40],
    [
      'Bridal Bangles',
      'bridal-bangles',
      'Heirloom-inspired bridal bangles and sets.',
      'wedding',
      50,
    ],
    ['Gifting Edit', 'gifting-edit', 'Jewelry selected for memorable gifts.', 'gifting', 60],
  ] as const
  const collectionList = []
  for (const [title, slug, summary, occasion, sortOrder] of collectionData) {
    collectionList.push(
      await ensureCollection(payload, { title, slug, summary, occasion, sortOrder }),
    )
  }
  const collections = new Map(collectionList.map((item) => [item.slug, item]))

  const color = await ensureAttributeDefinition(payload, {
    code: 'color',
    name: 'Color',
    sortOrder: 10,
  })
  const size = await ensureAttributeDefinition(payload, {
    code: 'size',
    name: 'Size',
    sortOrder: 20,
  })
  for (const [code, label, swatchHex, sortOrder] of [
    ['ruby-red', 'Ruby Red', '#9B1B30', 10],
    ['emerald-green', 'Emerald Green', '#176B52', 20],
    ['pearl-white', 'Pearl White', '#F4EAD8', 30],
    ['gold', 'Gold', '#C79022', 40],
    ['maroon', 'Maroon', '#6F1D2A', 50],
  ] as const) {
    await ensureAttributeOption(payload, color.id, { code, label, swatchHex, sortOrder })
  }
  for (const [code, label, sortOrder] of [
    ['free-size', 'Free Size', 10],
    ['2-4', '2.4', 20],
    ['2-6', '2.6', 30],
    ['2-8', '2.8', 40],
  ] as const) {
    await ensureAttributeOption(payload, size.id, { code, label, sortOrder })
  }

  for (const item of productSeeds) {
    const category = categories.get(item.category)
    const productCollections = item.collections.map((slug) => collections.get(slug)?.id)
    if (!category || productCollections.some((id) => id === undefined)) {
      throw new Error(`Seed relationships are missing for ${item.slug}.`)
    }

    const productData = {
      categories: [category.id],
      collections: productCollections as number[],
      featuredImage: media.id,
      gallery: [{ caption: item.name, image: media.id, sortOrder: 0 }],
      isFeatured: item.pricePaise >= 500000,
      isReturnable: true,
      jewelryDetails: {
        brand: 'Rajasthan Jewelry',
        material: item.material,
        plating: item.plating,
        stoneType: item.stoneType,
      },
      name: item.name,
      occasions: [{ occasion: item.occasion }],
      primaryCategory: category.id,
      returnWindowDays: 7,
      seo: {
        description: `Shop ${item.name}, crafted for ${item.occasion} occasions.`,
        title: `${item.name} | Rajasthan Jewelry`,
      },
      shortDescription: `${item.stoneType} jewelry finished in ${item.plating}.`,
      slug: item.slug,
      specifications: [
        { name: 'Material', value: item.material },
        { name: 'Plating', value: item.plating },
      ],
      status: 'draft' as const,
      styleTags: [{ label: 'Rajasthani' }, { label: item.occasion }],
      taxClass: 'standard' as const,
    }
    const existingProduct = await findBy(payload, 'products', 'slug', item.slug)
    const existingProductDocument = existingProduct.docs[0] as Product | undefined
    const product = existingProductDocument
      ? await payload.update({
          collection: 'products',
          id: existingProductDocument.id,
          data: productData,
        })
      : await payload.create({ collection: 'products', data: productData })

    const existingVariant = await findBy(payload, 'product-variants', 'sku', item.sku)
    const existingVariantDocument = existingVariant.docs[0] as ProductVariant | undefined
    const optionSignature = `${item.category === 'bangles' ? '2-4' : 'free-size'}|${item.colorCode}|`
    const variant = existingVariantDocument
      ? await payload.update({
          collection: 'product-variants',
          id: existingVariantDocument.id,
          data: {
            colorCode: item.colorCode,
            image: media.id,
            maxPerOrder: 5,
            optionSignature,
            pricePaise: item.pricePaise,
            product: product.id,
            sizeCode: item.category === 'bangles' ? '2-4' : 'free-size',
            sku: item.sku,
            status: 'active',
          },
        })
      : await payload.create({
          collection: 'product-variants',
          data: {
            colorCode: item.colorCode,
            image: media.id,
            maxPerOrder: 5,
            optionSignature,
            pricePaise: item.pricePaise,
            product: product.id,
            sizeCode: item.category === 'bangles' ? '2-4' : 'free-size',
            sku: item.sku,
            status: 'active',
          },
        })

    const existingInventory = await findBy(payload, 'inventory', 'variant', variant.id)
    if (!existingInventory.docs[0]) {
      await payload.create({
        collection: 'inventory',
        context: {
          inventoryAdjustment: { note: 'Phase 2 seed stock', reason: 'initial_stock' },
        },
        data: {
          onHand: item.stock,
          reserved: 0,
          reorderPoint: Math.min(5, item.stock),
          stockStatus: item.stock > 0 ? 'available' : 'out_of_stock',
          variant: variant.id,
        },
        overrideAccess: true,
      })
    }

    if (item.category === 'bangles') {
      for (const [sku, sizeCode, pricePaise, stock] of [
        ['RJ-BNG-RUBY-26', '2-6', 349900, 14],
        ['RJ-BNG-RUBY-28', '2-8', 359900, 9],
      ] as const) {
        const extraVariantResult = await findBy(payload, 'product-variants', 'sku', sku)
        const extraVariantDocument = extraVariantResult.docs[0] as ProductVariant | undefined
        const data = {
          colorCode: item.colorCode,
          image: media.id,
          maxPerOrder: 5,
          optionSignature: `${sizeCode}|${item.colorCode}|`,
          pricePaise,
          product: product.id,
          sizeCode,
          sku,
          status: 'active' as const,
        }
        const extraVariant = extraVariantDocument
          ? await payload.update({
              collection: 'product-variants',
              id: extraVariantDocument.id,
              data,
            })
          : await payload.create({ collection: 'product-variants', data })
        const extraInventory = await findBy(payload, 'inventory', 'variant', extraVariant.id)
        if (!extraInventory.docs[0]) {
          await payload.create({
            collection: 'inventory',
            context: {
              inventoryAdjustment: { note: 'Phase 2 seed stock', reason: 'initial_stock' },
            },
            data: {
              onHand: stock,
              reorderPoint: 5,
              reserved: 0,
              stockStatus: 'available',
              variant: extraVariant.id,
            },
            overrideAccess: true,
          })
        }
      }
    }

    await payload.update({
      collection: 'products',
      id: product.id,
      data: { status: 'active' },
    })
  }

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
