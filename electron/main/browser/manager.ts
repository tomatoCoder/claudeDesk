import { WebContentsView, type BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'
import type { BrowserPageState, BrowserPanelBounds, BrowserTarget } from '../../shared/browser-contracts.js'
import { browserSession } from './session.js'
import { isAllowedNavigation, normalizeBrowserUrl } from './navigation-policy.js'
import type { BrowserAnnotationStore } from './annotations.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export class BrowserManager {
  private readonly views = new Map<string, WebContentsView>()
  private activeTabId?: string
  private bounds?: BrowserPanelBounds
  private visible = false
  private readonly errors = new Map<string, string>()
  private annotationTaskId?: string

  constructor(private readonly window: BrowserWindow, private readonly annotations: BrowserAnnotationStore) {}

  setAnnotationMode(enabled: boolean, taskId?: string) {
    this.annotationTaskId = enabled ? taskId : undefined
    for (const view of this.views.values()) view.webContents.send('browser-annotation-mode', enabled)
    this.restoreAnnotations()
  }

  restoreAnnotations(tabId = this.activeTabId) {
    const view = tabId ? this.views.get(tabId) : undefined
    if (!view || !this.annotationTaskId) return
    const url = view.webContents.getURL()
    view.webContents.send('browser-annotation-markers', this.annotations.list(this.annotationTaskId).filter(value => value.url === url && value.status === 'active'))
  }

  create(tabId: string, bounds: BrowserPanelBounds) {
    this.ensureView(tabId)
    this.select(tabId)
    this.setBounds(bounds)
    this.publish(tabId, false)
  }

  async open(tabId: string, url: string, bounds: BrowserPanelBounds) {
    const target = normalizeBrowserUrl(url)
    const view = this.ensureView(tabId)
    this.select(tabId)
    this.setBounds(bounds)
    await view.webContents.loadURL(target)
  }

  select(tabId: string) {
    const next = this.views.get(tabId)
    if (!next) throw new AppError('browser_tab_missing', '浏览器标签页不存在', true)
    for (const [id, view] of this.views) view.setVisible(id === tabId && this.visible)
    this.activeTabId = tabId
    if (this.bounds) this.applyBounds(next, this.bounds)
    this.restoreAnnotations(tabId)
  }

  closeTab(tabId: string) {
    const view = this.views.get(tabId)
    if (!view) return
    this.window.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(tabId)
    this.errors.delete(tabId)
    if (this.activeTabId === tabId) this.activeTabId = undefined
  }

  setBounds(bounds: BrowserPanelBounds) {
    this.bounds = bounds
    const visible = bounds.visible && bounds.width > 0 && bounds.height > 0
    this.visible = visible
    const view = this.activeTabId ? this.views.get(this.activeTabId) : undefined
    if (!view) return
    this.applyBounds(view, bounds)
  }

  private applyBounds(view: WebContentsView, bounds: BrowserPanelBounds) {
    const x = Math.max(0, Math.min(Math.round(bounds.x), Math.round(bounds.viewportWidth)))
    const y = Math.max(0, Math.min(Math.round(bounds.y), Math.round(bounds.viewportHeight)))
    view.setBounds({ x, y, width: Math.max(1, Math.min(Math.round(bounds.width), Math.round(bounds.viewportWidth) - x)), height: Math.max(1, Math.min(Math.round(bounds.height), Math.round(bounds.viewportHeight) - y)) })
    view.setVisible(this.visible)
  }

  close() { for (const view of this.views.values()) view.setVisible(false); this.visible = false }
  refresh(tabId: string) { this.views.get(tabId)?.webContents.reload() }
  history(tabId: string, direction: 'back' | 'forward') { const contents = this.views.get(tabId)?.webContents; if (!contents) return; if (direction === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); if (direction === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward() }
  destroy() { for (const tabId of [...this.views.keys()]) this.closeTab(tabId) }

  private ensureView(tabId: string) {
    const existing = this.views.get(tabId)
    if (existing) return existing
    const view = new WebContentsView({ webPreferences: {
      preload: path.join(currentDirectory, '../../preload/browser.cjs'),
      session: browserSession(), nodeIntegration: false, contextIsolation: true, sandbox: true,
    } })
    this.window.contentView.addChildView(view); view.setVisible(false)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event, url) => { if (!isAllowedNavigation(url)) event.preventDefault() })
    view.webContents.on('did-start-loading', () => { this.errors.delete(tabId); this.publish(tabId, true) })
    view.webContents.on('did-stop-loading', () => this.publish(tabId, false, this.errors.get(tabId)))
    view.webContents.on('did-navigate', () => this.publish(tabId, view.webContents.isLoading()))
    view.webContents.on('did-navigate-in-page', () => this.publish(tabId, view.webContents.isLoading()))
    view.webContents.on('page-title-updated', () => this.publish(tabId, view.webContents.isLoading()))
    view.webContents.on('dom-ready', () => { view.webContents.send('browser-annotation-mode', !!this.annotationTaskId); this.restoreAnnotations(tabId) })
    view.webContents.on('ipc-message', (_event, channel, ...args) => {
      if (channel === 'browser-annotation-selected' && this.annotationTaskId) {
        const payload = args[0] as Record<string, unknown>
        const target = browserTarget(payload)
        if (!target || target.url !== view.webContents.getURL()) return
        let annotation = this.annotations.add(this.annotationTaskId, target)
        if (typeof payload.comment === 'string') this.annotations.update(this.annotationTaskId, annotation.id, payload.comment.slice(0, 2000))
        if (payload.style) annotation = this.annotations.updateStyle(this.annotationTaskId, annotation.id, browserStyle(payload.style)) || annotation
        this.publishAnnotations()
        this.window.webContents.send(IPC_CHANNELS.event('browser-comment'), { url: target.url, selection: target.text, comment: typeof payload.comment === 'string' ? payload.comment.slice(0, 2000) : '', selector: target.selector, tagName: target.tagName, style: annotation.style, originalStyle: browserStyle(payload.originalStyle) })
        this.restoreAnnotations(tabId)
      }
      if (channel === 'browser-annotation-stale' && this.annotationTaskId && Array.isArray(args[0])) {
        this.annotations.markStale(this.annotationTaskId, args[0].filter(value => typeof value === 'string'))
        this.publishAnnotations()
      }
    })
    view.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      const error = `${description} (${validatedURL})`
      this.errors.set(tabId, error)
      this.publish(tabId, false, error)
    })
    this.views.set(tabId, view)
    return view
  }

  publishAnnotations(taskId = this.annotationTaskId) {
    if (!taskId || this.window.isDestroyed()) return
    this.window.webContents.send(IPC_CHANNELS.event('browser-annotations-changed'), { taskId, annotations: this.annotations.list(taskId) })
  }

  private publish(tabId: string, loading: boolean, error?: string) {
    const contents = this.views.get(tabId)?.webContents
    if (!contents || this.window.isDestroyed()) return
    const payload: BrowserPageState = { tabId, url: contents.getURL(), title: contents.getTitle(), loading, canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), ...(error ? { error } : {}) }
    this.window.webContents.send(IPC_CHANNELS.event('browser-page-state'), payload)
  }
}

function browserStyle(value: unknown) {
  if (!value || typeof value !== 'object') return { color: '#000000', backgroundColor: '#ffffff', opacity: 1, fontFamily: 'Arial', fontSize: 16, fontWeight: '400', width: 0, height: 0, padding: [0, 0, 0, 0] as [number, number, number, number], margin: [0, 0, 0, 0] as [number, number, number, number], borderRadius: 0, borderColor: '#000000', borderWidth: 0 }
  const item = value as Record<string, unknown>
  const box = (key: string) => boxStyle(item[key])
  return { color: typeof item.color === 'string' ? item.color.slice(0, 32) : '#000000', backgroundColor: typeof item.backgroundColor === 'string' ? item.backgroundColor.slice(0, 32) : '#ffffff', opacity: typeof item.opacity === 'number' && Number.isFinite(item.opacity) ? Math.max(0, item.opacity) : 1, fontFamily: typeof item.fontFamily === 'string' ? item.fontFamily.slice(0, 80) : 'Arial', fontSize: numberStyle(item.fontSize, 16), fontWeight: typeof item.fontWeight === 'string' ? item.fontWeight.slice(0, 20) : '400', width: numberStyle(item.width, 0), height: numberStyle(item.height, 0), padding: box('padding'), margin: box('margin'), borderRadius: numberStyle(item.borderRadius, 0), borderColor: typeof item.borderColor === 'string' ? item.borderColor.slice(0, 32) : '#000000', borderWidth: numberStyle(item.borderWidth, 0) }
}
function numberStyle(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(2000, value)) : fallback }
function boxStyle(value: unknown): [number, number, number, number] { const items = Array.isArray(value) ? value.slice(0, 4).map(item => numberStyle(item, 0)) : []; return [items[0] ?? 0, items[1] ?? items[0] ?? 0, items[2] ?? items[0] ?? 0, items[3] ?? items[1] ?? items[0] ?? 0] }

function browserTarget(value: unknown): BrowserTarget | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Record<string, unknown>
  const rect = item.rect as Record<string, unknown> | undefined
  if (typeof item.selector !== 'string' || !item.selector || item.selector.length > 2000 || typeof item.tagName !== 'string' || typeof item.text !== 'string' || typeof item.fingerprint !== 'string' || typeof item.url !== 'string' || typeof item.title !== 'string' || !rect) return
  if (item.text.length > 500 || item.fingerprint.length > 500 || item.title.length > 500 || (item.kind !== 'element' && item.kind !== 'text') || !['x', 'y', 'width', 'height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]))) return
  return { selector: item.selector, tagName: item.tagName.slice(0, 100), text: item.text, fingerprint: item.fingerprint, kind: item.kind, url: item.url, title: item.title, rect: { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number } }
}
