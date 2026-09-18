import { randomUUID } from 'node:crypto'

export interface QueuedTurn { id: string; taskId: string; text: string; createdAt: string }

export class TurnQueue {
  private readonly turns = new Map<string, QueuedTurn[]>()
  list(taskId: string) { return [...(this.turns.get(taskId) || [])] }
  push(taskId: string, text: string) { const turn = { id: randomUUID(), taskId, text, createdAt: new Date().toISOString() }; this.queue(taskId).push(turn); return turn }
  update(taskId: string, id: string, text: string) { const turn = this.queue(taskId).find((value) => value.id === id); if (turn) turn.text = text; return turn }
  take(taskId: string, id: string) { const queue = this.queue(taskId); const index = queue.findIndex((value) => value.id === id); if (index < 0) return; return { turn: queue.splice(index, 1)[0], index } }
  takeFront(taskId: string) { const turn = this.queue(taskId).shift(); return turn ? { turn, index: 0 } : undefined }
  remove(taskId: string, id: string) { return this.take(taskId, id)?.turn }
  restore(taskId: string, index: number, turn: QueuedTurn) { const queue = this.queue(taskId); queue.splice(Math.min(index, queue.length), 0, turn) }
  private queue(taskId: string) { let queue = this.turns.get(taskId); if (!queue) { queue = []; this.turns.set(taskId, queue) } return queue }
}
