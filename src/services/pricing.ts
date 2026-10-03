import type { Cart, CartItem, Coupon, Product, ProductVariant, Promotion } from '../payload-types'
import type { PayloadRequest } from 'payload'

import { MobileAPIError } from '../lib/api-response'
import { relationshipID } from '../lib/catalog'

type LoadedLine = {
  item: CartItem
  product: Product
  quantity: number
  variant: ProductVariant
}

const IDs = (values: unknown): Set<string> =>
  new Set(
    (Array.isArray(values) ? values : [])
      .map(relationshipID)
      .filter((value): value is number | string => value !== undefined)
      .map(String),
  )

const activeAt = (startsAt?: null | string, endsAt?: null | string): boolean => {
  const now = Date.now()
  return (
    (!startsAt || new Date(startsAt).getTime() <= now) &&
    (!endsAt || new Date(endsAt).getTime() > now)
  )
}

const eligibleLine = (line: LoadedLine, promotion: Promotion): boolean => {
  const products = IDs(promotion.applicableProducts)
  const categories = IDs(promotion.applicableCategories)
  if (products.size === 0 && categories.size === 0) return true
  if (products.has(String(line.product.id))) return true
  const productCategories = IDs([line.product.primaryCategory, ...(line.product.categories ?? [])])
  return [...categories].some((category) => productCategories.has(category))
}

export const calculateDiscountPaise = ({
  discountType,
  discountValue,
  eligibleSubtotalPaise,
  maxDiscountPaise,
  subtotalPaise,
}: {
  discountType: 'fixed' | 'percentage'
  discountValue: number
  eligibleSubtotalPaise: number
  maxDiscountPaise?: null | number
  subtotalPaise: number
}): number => {
  let discount =
    discountType === 'percentage'
      ? Math.floor((eligibleSubtotalPaise * discountValue) / 100)
      : Math.min(eligibleSubtotalPaise, discountValue)
  if (maxDiscountPaise != null) discount = Math.min(discount, maxDiscountPaise)
  return Math.max(0, Math.min(discount, subtotalPaise))
}

export const calculateCartPricing = async (req: PayloadRequest, cart: Cart, items: CartItem[]) => {
  // Two batched reads instead of two queries per cart line.
  const variantIDs = [...new Set(items.map((item) => relationshipID(item.variant)).filter(Boolean))]
  const variantDocs = variantIDs.length
    ? await req.payload.find({
        collection: 'product-variants',
        depth: 0,
        limit: variantIDs.length,
        overrideAccess: true,
        pagination: false,
        req,
        where: { id: { in: variantIDs } },
      })
    : { docs: [] as ProductVariant[] }
  const variantsByID = new Map(variantDocs.docs.map((variant) => [String(variant.id), variant]))
  const productIDs = [
    ...new Set(variantDocs.docs.map((variant) => relationshipID(variant.product)).filter(Boolean)),
  ]
  const productDocs = productIDs.length
    ? await req.payload.find({
        collection: 'products',
        depth: 1,
        limit: productIDs.length,
        overrideAccess: true,
        pagination: false,
        req,
        where: { id: { in: productIDs } },
      })
    : { docs: [] as Product[] }
  const productsByID = new Map(productDocs.docs.map((product) => [String(product.id), product]))

  const lines: LoadedLine[] = []
  for (const item of items) {
    const variant = variantsByID.get(String(relationshipID(item.variant)))
    const product = variant ? productsByID.get(String(relationshipID(variant.product))) : undefined
    if (!variant || !product) continue
    lines.push({ item, product, quantity: Number(item.quantity), variant })
  }

  const pricedLines = lines.map(({ item, product, quantity, variant }) => ({
    itemId: item.id,
    product: {
      category: typeof product.primaryCategory === 'object' ? product.primaryCategory.name : null,
      id: product.id,
      imageUrl:
        (typeof variant.image === 'object' && variant.image?.url) ||
        (typeof product.featuredImage === 'object' && product.featuredImage?.url) ||
        null,
      name: product.name,
      slug: product.slug,
      status: product.status,
    },
    variant: {
      id: variant.id,
      sku: variant.sku,
      sizeCode: variant.sizeCode ?? null,
      colorCode: variant.colorCode ?? null,
      status: variant.status,
    },
    quantity,
    unitPricePaise: variant.pricePaise,
    lineTotalPaise: variant.pricePaise * quantity,
    valid: product.status === 'active' && variant.status === 'active',
  }))
  const subtotalPaise = pricedLines.reduce((sum, line) => sum + line.lineTotalPaise, 0)

  let couponSummary: null | { code: string; id: number; promotion: string } = null
  let discountPaise = 0
  const couponID = relationshipID(cart.coupon)
  if (couponID) {
    const coupon = (await req.payload.findByID({
      collection: 'coupons',
      id: couponID,
      depth: 0,
      overrideAccess: true,
      req,
    })) as Coupon
    const promotionID = relationshipID(coupon.promotion)
    const promotion = promotionID
      ? ((await req.payload.findByID({
          collection: 'promotions',
          id: promotionID,
          depth: 1,
          overrideAccess: true,
          req,
        })) as Promotion)
      : null
    if (
      promotion &&
      coupon.status === 'active' &&
      promotion.status === 'active' &&
      activeAt(coupon.startsAt, coupon.endsAt) &&
      activeAt(promotion.startsAt, promotion.endsAt) &&
      subtotalPaise >= Number(coupon.minimumCartPaise ?? 0) &&
      Number(coupon.usageLimit ?? 1) !== 0 &&
      Number(coupon.perCustomerLimit ?? 1) !== 0
    ) {
      const eligibleSubtotal = lines.reduce(
        (sum, line) =>
          sum + (eligibleLine(line, promotion) ? line.variant.pricePaise * line.quantity : 0),
        0,
      )
      discountPaise = calculateDiscountPaise({
        discountType: promotion.discountType,
        discountValue: promotion.discountValue,
        eligibleSubtotalPaise: eligibleSubtotal,
        maxDiscountPaise: promotion.maxDiscountPaise,
        subtotalPaise,
      })
      // A coupon that discounts nothing (no eligible products) is not reported as applied.
      if (discountPaise > 0)
        couponSummary = { code: coupon.code, id: coupon.id, promotion: promotion.name }
    }
  }

  return {
    amountUnit: 'paise' as const,
    coupon: couponSummary,
    currency: 'INR' as const,
    discountPaise,
    estimatedTotalPaise: Math.max(0, subtotalPaise - discountPaise),
    lines: pricedLines,
    subtotalPaise,
  }
}

export const validateCouponForCart = async (
  req: PayloadRequest,
  code: string,
  subtotalPaise: number,
) => {
  const result = await req.payload.find({
    collection: 'coupons',
    depth: 1,
    limit: 1,
    overrideAccess: true,
    req,
    where: { code: { equals: code } },
  })
  const coupon = result.docs[0]
  if (!coupon || coupon.status !== 'active') {
    throw new MobileAPIError('INVALID_COUPON', 'Coupon is invalid or unavailable.', 422)
  }
  const promotion = typeof coupon.promotion === 'object' ? coupon.promotion : null
  if (!promotion || promotion.status !== 'active') {
    throw new MobileAPIError('INVALID_COUPON', 'Coupon is invalid or unavailable.', 422)
  }
  if (
    !activeAt(coupon.startsAt, coupon.endsAt) ||
    !activeAt(promotion.startsAt, promotion.endsAt)
  ) {
    throw new MobileAPIError('COUPON_EXPIRED', 'Coupon is outside its validity period.', 422)
  }
  if (subtotalPaise < Number(coupon.minimumCartPaise ?? 0)) {
    throw new MobileAPIError(
      'MINIMUM_CART_NOT_MET',
      `Cart subtotal must be at least ${coupon.minimumCartPaise} paise.`,
      422,
    )
  }
  if (Number(coupon.usageLimit ?? 1) === 0 || Number(coupon.perCustomerLimit ?? 1) === 0) {
    throw new MobileAPIError('COUPON_LIMIT_REACHED', 'Coupon usage limit has been reached.', 422)
  }
  return coupon
}
