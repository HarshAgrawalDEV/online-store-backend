import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableLambda } from '@langchain/core/runnables'

export type DraftRequest = {
  /** A photo as a data: URL, when there is one. */
  image?: null | string
  /** The task and facts. */
  prompt: string
  /** The standing rules. */
  system: string
}

/** Some models print their reasoning in <think> tags first; only the answer is wanted. */
const withoutReasoning = (text: string): string =>
  text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

/**
 * prompt → chat model → plain text. Written as a LangChain runnable so the model can be swapped
 * for any provider, and retries, fallbacks or tracing can be added around it without changing callers.
 */
export const buildDraftChain = (model: BaseChatModel) =>
  RunnableLambda.from((request: DraftRequest) => [
    new SystemMessage(request.system),
    new HumanMessage({
      content: [
        { text: request.prompt, type: 'text' as const },
        ...(request.image
          ? [{ image_url: { url: request.image }, type: 'image_url' as const }]
          : []),
      ],
    }),
  ])
    .pipe(model)
    .pipe(new StringOutputParser())
    .pipe(RunnableLambda.from(withoutReasoning))
