import fs from 'node:fs/promises'
import path from 'node:path'

import type { PayloadRequest } from 'payload'
import sharp from 'sharp'

import { buildDraftChain } from '../ai/draft-chain'
import { configuredModelName, getChatModel, toProviderError } from '../ai/models'
import { MobileAPIError } from '../lib/api-response'
import { findForbiddenWording, findWrongTerm, textToLexical } from '../lib/description-guard'
import { relationshipID } from '../lib/catalog'
import { describeComponents } from '../lib/jewellery'
import { describeSet, type SetDetails } from '../lib/set-details'

// Groq accepts base64 images up to 4 MB; staying well under it keeps requests fast.
const MAX_IMAGE_BYTES = 3_000_000

const SYSTEM_PROMPT = [
  'You write short product descriptions for an Indian shop selling bangles and imitation (artificial) jewellery.',
  'Write in simple English with a few Hindi words in Latin letters where natural (for example shaadi).',
  'Use only the facts given in the form and what is clearly visible in the photo.',
  'Use the exact piece counts given. Never invent sizes, prices, weights, or materials.',
  'Do not say anything about weight, comfort, durability or quality unless it is in the facts.',
  'Never mention real ivory, tusk or animal products; if the product is cream coloured, call it cream. Boor is a synthetic material.',
  'Two short paragraphs, under 90 words in total. No emojis, no hashtags, no claims about health or luck.',
].join(' ')

/** What to call the item, so a bangle set is never described as a kada or a chuda. */
const NAMING: Record<string, string> = {
  jewellery:
    'This is imitation jewellery. Say "gold-look" or "gold-tone" for the polish, never gold, real, pure, hallmark or karat. Never call stones diamonds, rubies or emeralds: say "AD stones", "ruby-red stones" or "green stones". Beads are "pearl-look beads". Name only the parts listed and their quantities.',
  bangle_set:
    'This is a set of bangles. Call the pieces "bangles". Never use the words kada or chuda.',
  kada_pair:
    'This is a pair of kadas (thick, single bangles), one for each hand. Never use the word chuda or call them a bangle set.',
  complete_set:
    'This is a complete set of two kadas plus bangles, worn together. Never use the word chuda.',
  chuda_set:
    'This is a chuda: a bridal bangle set with the same number of bangles for each hand. Never use the word kada.',
}

export type DraftOptions = {
  /** What staff want changed, for example "make it shorter and mention Teej". */
  instructions?: string
  /** The draft being improved or replaced. */
  previousDraft?: string
}

export const parseDraftOptions = (value: unknown): DraftOptions => {
  if (!value || typeof value !== 'object') return {}
  const body = value as Record<string, unknown>
  const clean = (input: unknown, max: number) =>
    typeof input === 'string' ? input.trim().slice(0, max) || undefined : undefined
  return {
    instructions: clean(body.instructions, 400),
    previousDraft: clean(body.previousDraft, 2000),
  }
}

const loadFacts = async (req: PayloadRequest, productID: number) => {
  const found = await req.payload.find({
    collection: 'products',
    depth: 2,
    limit: 1,
    overrideAccess: true,
    req,
    where: { id: { equals: productID } },
  })
  const product = found.docs[0]
  if (!product) throw new MobileAPIError('PRODUCT_NOT_FOUND', 'Product not found.', 404)

  const variants = await req.payload.find({
    collection: 'product-variants',
    depth: 0,
    limit: 200,
    overrideAccess: true,
    pagination: false,
    req,
    where: { product: { equals: productID } },
  })
  const unique = (values: Array<null | string | undefined>) => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ]
  const material = typeof product.material === 'object' ? product.material : null
  const occasions = (product.occasions ?? [])
    .map((value) => (typeof value === 'object' ? value.name : null))
    .filter(Boolean)
  const jewellery = product.jewellery
  const piece = (entry: NonNullable<NonNullable<typeof jewellery>['components']>[number]) =>
    typeof entry.piece === 'object' && entry.piece
      ? describeComponents([
          {
            name: entry.piece.name,
            quantity: Number(entry.quantity ?? 1),
            soldAsPair: Boolean(entry.piece.soldAsPair),
          },
        ])
      : ''
  const names = (values: unknown) =>
    (Array.isArray(values) ? values : [])
      .map((value) =>
        typeof value === 'object' && value ? (value as { name?: string }).name : null,
      )
      .filter(Boolean)
      .join(', ')
  const facts =
    product.department === 'jewellery'
      ? [
          `Product name: ${product.name}`,
          `What is included: ${(jewellery?.components ?? []).map(piece).filter(Boolean).join(' + ') || 'not set'}`,
          typeof jewellery?.finish === 'object' && jewellery.finish
            ? `Finish: ${jewellery.finish.name}`
            : '',
          names(jewellery?.styles) ? `Style: ${names(jewellery?.styles)}` : '',
          names(jewellery?.stoneTypes) ? `Stones: ${names(jewellery?.stoneTypes)}` : '',
          jewellery?.wear ? `Worn: ${jewellery.wear.replace('_', ' ')}` : '',
          jewellery?.fit ? `Fit: ${jewellery.fit}` : '',
          `Colours: ${unique(variants.docs.map((variant) => variant.colourLabel)).join(', ') || 'not set'}`,
          occasions.length ? `Good for: ${occasions.join(', ')}` : '',
          product.shortDescription ? `Staff note: ${product.shortDescription}` : '',
        ].filter(Boolean)
      : [
          `Product name: ${product.name}`,
          material ? `Material: ${material.name}` : '',
          describeSet((product.setDetails ?? {}) as SetDetails)
            ? `What is sold: ${describeSet((product.setDetails ?? {}) as SetDetails)}, for both hands`
            : '',
          `Colours: ${unique(variants.docs.map((variant) => variant.colourLabel)).join(', ') || 'not set'}`,
          `Sizes: ${unique(variants.docs.map((variant) => variant.sizeLabel)).join(', ') || 'not set'}`,
          occasions.length ? `Good for: ${occasions.join(', ')}` : '',
          product.shortDescription ? `Staff note: ${product.shortDescription}` : '',
        ].filter(Boolean)
  return {
    department: product.department as string,
    facts: facts.join('\n'),
    product,
    productType:
      product.department === 'jewellery' ? 'jewellery' : (product.setDetails?.productType ?? null),
  }
}

const loadImageDataUri = async (
  req: PayloadRequest,
  product: { featuredImage?: unknown },
): Promise<string | null> => {
  const mediaID = relationshipID(product.featuredImage)
  if (!mediaID) return null
  const media = await req.payload.findByID({
    collection: 'media',
    depth: 0,
    id: mediaID,
    overrideAccess: true,
    req,
  })
  if (!media.filename) return null
  try {
    const file = await fs.readFile(path.resolve(process.cwd(), 'media', media.filename))
    const resized = await sharp(file)
      .rotate()
      .resize({ fit: 'inside', height: 1024, width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    if (resized.byteLength > MAX_IMAGE_BYTES) return null
    return `data:image/jpeg;base64,${resized.toString('base64')}`
  } catch {
    // A missing or unreadable photo should not block a text-only draft.
    return null
  }
}

/**
 * Writes a draft into the product's aiDraft block. It never touches the published description.
 * Staff can ask for changes or another version by passing instructions and the previous draft.
 */
export const generateDescriptionDraft = async (
  req: PayloadRequest,
  productID: number,
  options: DraftOptions = {},
) => {
  // Which provider and model answer is a server setting (AI_PROVIDER, AI_MODEL), not feature code.
  const chain = buildDraftChain(getChatModel({ maxTokens: 300, temperature: 0.6 }))
  const modelName = configuredModelName()
  const { department, facts, product, productType } = await loadFacts(req, productID)
  const image = await loadImageDataUri(req, product)

  const parts = ['Write the description.', NAMING[productType ?? ''] ?? '', `Facts:\n${facts}`]
  if (options.previousDraft) {
    parts.push(
      `Earlier draft:\n${options.previousDraft}`,
      options.instructions
        ? 'Rewrite it following the staff request below.'
        : 'Write a clearly different version with fresh wording and a different opening.',
    )
  }
  if (options.instructions) {
    parts.push(
      `Staff request: ${options.instructions}`,
      'Follow it, but keep every rule above; the facts and naming rules always win.',
    )
  }

  let text = ''
  let feedback = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await chain
      .invoke({
        image,
        prompt: [...parts, feedback].filter(Boolean).join('\n\n'),
        system: SYSTEM_PROMPT,
      })
      .catch((error: unknown) => {
        throw toProviderError(error)
      })
    const forbidden = findForbiddenWording(candidate, department)
    const wrong = findWrongTerm(candidate, productType)
    if (candidate && !forbidden && !wrong) {
      text = candidate
      break
    }
    feedback = forbidden
      ? `Your last answer used "${forbidden}", which must never appear. Write it again without it.`
      : wrong
        ? `Your last answer used "${wrong}", which is the wrong word for this product. ${NAMING[productType ?? ''] ?? ''}`
        : 'Your last answer was empty. Write the description.'
  }
  if (!text) {
    throw new MobileAPIError(
      'DRAFT_REJECTED',
      'The draft could not be used. Please try again.',
      422,
    )
  }

  const aiDraft = {
    generatedAt: new Date().toISOString(),
    model: modelName,
    text: text.slice(0, 2000),
  }
  await req.payload.update({
    collection: 'products',
    data: { aiDraft },
    id: productID,
    overrideAccess: true,
    req,
  })
  return aiDraft
}

/** Copies the reviewed draft into the real description. Staff still choose when to publish. */
export const applyDescriptionDraft = async (req: PayloadRequest, productID: number) => {
  const product = await req.payload
    .findByID({
      collection: 'products',
      depth: 0,
      id: productID,
      overrideAccess: true,
      req,
    })
    .catch(() => null)
  if (!product) throw new MobileAPIError('PRODUCT_NOT_FOUND', 'Product not found.', 404)
  const text = product.aiDraft?.text?.trim()
  if (!text) throw new MobileAPIError('NO_DRAFT', 'There is no draft to apply.', 400)
  const forbidden = findForbiddenWording(text, product.department)
  if (forbidden) {
    throw new MobileAPIError(
      'DRAFT_REJECTED',
      `The draft mentions "${forbidden}". Edit it first.`,
      422,
    )
  }
  await req.payload.update({
    collection: 'products',
    data: { description: textToLexical(text) as never },
    id: productID,
    overrideAccess: true,
    req,
  })
  return { applied: true }
}
