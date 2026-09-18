import { randomUUID } from 'node:crypto'
import type { BrowserAnnotation, BrowserTarget } from '../../shared/browser-contracts.js'

export class BrowserAnnotationStore {
  private readonly values = new Map<string, BrowserAnnotation[]>()

  list(taskId: string) { return [...(this.values.get(taskId) ?? [])] }
  add(taskId: string, target: BrowserTarget) {
    const value: BrowserAnnotation = { ...target, id: randomUUID(), taskId, comment: '', status: 'active', createdAt: new Date().toISOString() }
    this.values.set(taskId, [...this.list(taskId), value]); return value
  }
  update(taskId: string, id: string, comment: string) { return this.change(taskId, id, value => ({ ...value, comment })) }
  markStale(taskId: string, ids: string[]) { const stale = new Set(ids); for (const id of stale) this.change(taskId, id, value => ({ ...value, status: 'stale' })) }
  delete(taskId: string, id: string) { this.values.set(taskId, this.list(taskId).filter(value => value.id !== id)) }
  clear(taskId: string) { this.values.delete(taskId) }
  private change(taskId: string, id: string, change: (value: BrowserAnnotation) => BrowserAnnotation) {
    let updated: BrowserAnnotation | undefined
    this.values.set(taskId, this.list(taskId).map(value => value.id === id ? updated = change(value) : value))
    return updated
  }
}
