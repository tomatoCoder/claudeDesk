import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RunControl } from './protocol.js'

export type AdjustmentResult =
  | { type: 'run.adjust.accepted'; adjustmentId: string }
  | { type: 'run.adjust.rejected'; adjustmentId: string; reason: string }

export interface AdjustmentReceipt {
  queued: boolean
  result: Promise<AdjustmentResult>
}

export function applyRunControl(
  input: RunInput,
  control: Extract<RunControl, { type: 'run.adjust' }>,
): AdjustmentResult {
  return input.adjust(control.text.trim(), control.adjustmentId)
    ? acceptedAdjustment(control.adjustmentId)
    : rejectedAdjustment(control.adjustmentId)
}

export function applyRunControlWithReceipt(
  input: RunInput,
  control: Extract<RunControl, { type: 'run.adjust' }>,
): AdjustmentReceipt {
  const delivery = input.adjustWithReceipt(control.text.trim(), control.adjustmentId)
  return {
    queued: delivery.queued,
    result: delivery.delivered.then((delivered) => delivered
      ? acceptedAdjustment(control.adjustmentId)
      : rejectedAdjustment(control.adjustmentId)),
  }
}

function acceptedAdjustment(adjustmentId: string): AdjustmentResult {
  return { type: 'run.adjust.accepted', adjustmentId }
}

function rejectedAdjustment(adjustmentId: string): AdjustmentResult {
  return { type: 'run.adjust.rejected', adjustmentId, reason: '当前任务已经结束' }
}

interface QueuedMessage {
  message: SDKUserMessage
  settleDelivery?: (delivered: boolean) => void
}

export class RunInput implements AsyncIterable<SDKUserMessage> {
  private readonly messages: QueuedMessage[]
  private waitingNext: ((result: IteratorResult<SDKUserMessage>) => void) | undefined
  private closed = false

  constructor(initialPrompt: string, initialId: string) {
    this.messages = [{ message: this.createMessage(initialPrompt, initialId) }]
  }

  adjust(text: string, adjustmentId: string): boolean {
    if (this.closed) return false

    this.enqueue({ message: this.createAdjustmentMessage(text, adjustmentId) })
    return true
  }

  adjustWithReceipt(text: string, adjustmentId: string): { queued: boolean; delivered: Promise<boolean> } {
    if (this.closed) return { queued: false, delivered: Promise.resolve(false) }

    let settleDelivery: (delivered: boolean) => void = () => undefined
    const delivered = new Promise<boolean>((resolve) => {
      settleDelivery = resolve
    })

    this.enqueue({
      message: this.createAdjustmentMessage(text, adjustmentId),
      settleDelivery,
    })
    return { queued: true, delivered }
  }

  close(): void {
    this.closed = true
    if (this.messages.length === 0) this.resolveClosedIterator()
  }

  finish(): void {
    this.closed = true
    for (const entry of this.messages) entry.settleDelivery?.(false)
    this.messages.length = 0
    this.resolveClosedIterator()
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

  private createAdjustmentMessage(text: string, adjustmentId: string): SDKUserMessage {
    return {
      ...this.createMessage(text, adjustmentId),
      priority: 'now',
    }
  }

  private enqueue(entry: QueuedMessage): void {
    if (this.waitingNext) {
      const resolve = this.waitingNext
      this.waitingNext = undefined
      resolve({ value: entry.message, done: false })
      entry.settleDelivery?.(true)
      return
    }
    this.messages.push(entry)
  }

  private next(): Promise<IteratorResult<SDKUserMessage>> {
    const entry = this.messages.shift()
    if (entry) {
      entry.settleDelivery?.(true)
      return Promise.resolve({ value: entry.message, done: false })
    }
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
