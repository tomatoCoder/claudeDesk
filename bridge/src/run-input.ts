import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export class RunInput implements AsyncIterable<SDKUserMessage> {
  private readonly messages: SDKUserMessage[]
  private waitingNext: ((result: IteratorResult<SDKUserMessage>) => void) | undefined
  private closed = false

  constructor(initialPrompt: string, initialId: string) {
    this.messages = [this.createMessage(initialPrompt, initialId)]
  }

  adjust(text: string, adjustmentId: string): boolean {
    if (this.closed) return false

    this.enqueue({
      ...this.createMessage(text, adjustmentId),
      priority: 'now',
    })
    return true
  }

  close(): void {
    this.closed = true
    if (this.messages.length === 0) this.resolveClosedIterator()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => this.next(),
    }
  }

  private createMessage(text: string, uuid: string): SDKUserMessage {
    return {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage['uuid'],
    }
  }

  private enqueue(message: SDKUserMessage): void {
    if (this.waitingNext) {
      const resolve = this.waitingNext
      this.waitingNext = undefined
      resolve({ value: message, done: false })
      return
    }
    this.messages.push(message)
  }

  private next(): Promise<IteratorResult<SDKUserMessage>> {
    const message = this.messages.shift()
    if (message) return Promise.resolve({ value: message, done: false })
    if (this.closed) return Promise.resolve({ value: undefined, done: true })

    return new Promise((resolve) => {
      this.waitingNext = resolve
    })
  }

  private resolveClosedIterator(): void {
    if (!this.waitingNext) return

    const resolve = this.waitingNext
    this.waitingNext = undefined
    resolve({ value: undefined, done: true })
  }
}
