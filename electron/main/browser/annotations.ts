import { randomUUID } from 'node:crypto'
import type { BrowserAnnotation, BrowserAnnotationStyle, BrowserTarget } from '../../shared/browser-contracts.js'

export class BrowserAnnotationStore {
  private readonly values = new Map<string, BrowserAnnotation[]>()

  list(taskId: string) { return [...(this.values.get(taskId) ?? [])] }
  add(taskId: string, target: BrowserTarget) {
    const value: BrowserAnnotation = { ...target, id: randomUUID(), taskId, comment: '', status: 'active', createdAt: new Date().toISOString(), style: defaultStyle() }
    this.values.set(taskId, [...this.list(taskId), value]); return value
  }
  update(taskId: string, id: string, comment: string) { return this.change(taskId, id, value => ({ ...value, comment })) }
  updateStyle(taskId: string, id: string, style: BrowserAnnotationStyle) { return this.change(taskId, id, value => ({ ...value, style })) }
  markStale(taskId: string, ids: string[]) { const stale = new Set(ids); for (const id of stale) this.change(taskId, id, value => ({ ...value, status: 'stale' })) }
  delete(taskId: string, id: string) { this.values.set(taskId, this.list(taskId).filter(value => value.id !== id)) }
  clear(taskId: string) { this.values.delete(taskId) }
  private change(taskId: string, id: string, change: (value: BrowserAnnotation) => BrowserAnnotation) {
    let updated: BrowserAnnotation | undefined
    this.values.set(taskId, this.list(taskId).map(value => value.id === id ? updated = change(value) : value))
    return updated
  }
}

function defaultStyle(): BrowserAnnotationStyle { return { color: '#000000', backgroundColor: '#ffffff', opacity: 1, fontFamily: 'Arial', fontSize: 16, fontWeight: '400', width: 0, height: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], borderRadius: 0, borderColor: '#000000', borderWidth: 0 } }
