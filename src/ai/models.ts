import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

import { ChatGroq } from '@langchain/groq'

import { MobileAPIError } from '../lib/api-response'

/**
 * Every AI feature asks this file for its chat model, and nothing else imports a provider package.
 * To add a provider (OpenAI, Gemini, Anthropic...): install its LangChain package, add a case to
 * `createModel` and a default to `DEFAULT_MODELS`, then set AI_PROVIDER. No feature code changes.
 */
export const providers = ['groq'] as const
export type AIProvider = (typeof providers)[number]

const DEFAULT_MODELS: Record<AIProvider, string> = {
  groq: 'qwen/qwen3.8-27b',
}

export type ModelSettings = {
  maxTokens?: number
  temperature?: number
}

let testModel: BaseChatModel | undefined

/** Tests plug in a scripted model here instead of calling a real provider. */
export const setChatModelForTests = (model?: BaseChatModel): void => {
  testModel = model
}

const notConfigured = (message: string) => new MobileAPIError('DRAFT_NOT_CONFIGURED', message, 503)

const configuredProvider = (): AIProvider => {
  const name = (process.env.AI_PROVIDER ?? 'groq').trim().toLowerCase()
  if (!(providers as readonly string[]).includes(name)) {
    throw notConfigured(
      `The AI provider "${name}" is not supported. Use one of: ${providers.join(', ')}.`,
    )
  }
  return name as AIProvider
}

/** The model name in use, for example "qwen/qwen3.8-27b". AI_MODEL wins; GROQ_MODEL still works for Groq. */
export const configuredModelName = (): string => {
  const provider = configuredProvider()
  return (
    process.env.AI_MODEL?.trim() ||
    (provider === 'groq' ? process.env.GROQ_MODEL?.trim() : undefined) ||
    DEFAULT_MODELS[provider]
  )
}

const createModel = (settings: ModelSettings): BaseChatModel => {
  const provider = configuredProvider()
  const model = configuredModelName()
  switch (provider) {
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY
      if (!apiKey) throw notConfigured('Description drafts are not set up on this server.')
      return new ChatGroq({
        apiKey,
        maxRetries: 1,
        maxTokens: settings.maxTokens,
        model,
        temperature: settings.temperature,
      })
    }
  }
}

export const getChatModel = (settings: ModelSettings = {}): BaseChatModel =>
  testModel ?? createModel(settings)

/** Plain-language message for a provider failure. The raw detail is logged, never shown to staff. */
export const toProviderError = (error: unknown): MobileAPIError => {
  if (error instanceof MobileAPIError) return error
  const failure = error as { message?: string; name?: string; status?: number }
  const status = failure.status
  console.error(
    `AI request failed: ${status ?? failure.name ?? 'error'} ${String(failure.message).slice(0, 500)}`,
  )
  const reasons: Record<number, string> = {
    400: 'The description service rejected the request. Check the model name and the product photo.',
    401: 'The description service key is not valid. Check the API key in the server settings.',
    403: 'The description service key is not allowed to use this model.',
    404: 'The description model was not found. Check AI_MODEL (or GROQ_MODEL).',
    429: 'The description service is busy or the daily limit is reached. Try again later.',
  }
  const timedOut = /timeout|timed out|abort/i.test(`${failure.name} ${failure.message}`)
  return new MobileAPIError(
    'DRAFT_PROVIDER_ERROR',
    (status && reasons[status]) ||
      (timedOut
        ? 'The description service took too long. Try again.'
        : 'The description service did not respond. Try again shortly.'),
    502,
  )
}
