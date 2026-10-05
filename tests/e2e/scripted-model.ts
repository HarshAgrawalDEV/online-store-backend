import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatResult } from '@langchain/core/outputs'

import { setChatModelForTests } from '../../src/ai/models'

/**
 * A chat model that returns scripted replies and remembers what it was sent, so tests can check the
 * prompt without a real provider. The last reply repeats once the list runs out.
 */
export class ScriptedChatModel extends BaseChatModel {
  calls: BaseMessage[][] = []
  private readonly replies: string[]

  constructor(replies: string[]) {
    super({})
    this.replies = [...replies]
  }

  _llmType(): string {
    return 'scripted'
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages)
    const text = (this.replies.length > 1 ? this.replies.shift() : this.replies[0]) ?? ''
    return { generations: [{ message: new AIMessage(text), text }] }
  }

  /** Everything sent in call number `index` (0 is the first), as one string. */
  sent(index: number): string {
    return JSON.stringify(this.calls[index]?.map((message) => message.content))
  }
}

/** Installs a scripted model for the AI features. Call `restore()` in a `finally`. */
export const scriptModel = (replies: string[]) => {
  const model = new ScriptedChatModel(replies)
  setChatModelForTests(model)
  return { model, restore: () => setChatModelForTests(undefined) }
}
