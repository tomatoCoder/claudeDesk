import { shell } from 'electron'
import { AppError } from '../../shared/errors.js'
import type { BrowserPanelBounds } from '../../shared/browser-contracts.js'
import { registerCommand } from '../ipc.js'
import type { BrowserManager } from './manager.js'
import type { BrowserAnnotationStore } from './annotations.js'

export function registerBrowserCommands(browser: BrowserManager, annotations: BrowserAnnotationStore) {
  registerCommand('open_browser_panel', ({ url, bounds }) => browser.open(text(url), browserBounds(bounds)))
  registerCommand('open_browser', ({ url }) => browser.open(text(url), { x: 0, y: 0, width: 1, height: 1, viewportWidth: 1, viewportHeight: 1, visible: false }))
  registerCommand('set_browser_panel_bounds', ({ bounds }) => browser.setBounds(browserBounds(bounds)))
  registerCommand('browser_history', ({ direction }) => { if (direction !== 'back' && direction !== 'forward') throw new AppError('browser_history_invalid', '浏览器历史方向无效', true); browser.history(direction) })
  registerCommand('refresh_browser_panel', () => browser.refresh())
  registerCommand('close_browser_panel', () => browser.close())
  registerCommand('set_browser_annotation_mode', ({ enabled, taskId }) => browser.setAnnotationMode(enabled === true, optionalText(taskId)))
  registerCommand('list_browser_annotations', ({ taskId }) => annotations.list(text(taskId)))
  registerCommand('update_browser_annotation', ({ taskId, id, comment }) => { const value = annotations.update(text(taskId), text(id), text(comment)); browser.publishAnnotations(text(taskId)); return value })
  registerCommand('delete_browser_annotation', ({ taskId, id }) => { annotations.delete(text(taskId), text(id)); browser.publishAnnotations(text(taskId)); browser.restoreAnnotations() })
  registerCommand('clear_browser_annotations', ({ taskId }) => { annotations.clear(text(taskId)); browser.publishAnnotations(text(taskId)); browser.restoreAnnotations() })
  registerCommand('open_doubao_in_chrome', () => shell.openExternal('https://www.doubao.com'))
}
function text(value: unknown) { if (typeof value !== 'string') throw new AppError('invalid_argument', '参数格式无效', true); return value }
function optionalText(value: unknown) { return typeof value === 'string' ? value : undefined }
function browserBounds(value: unknown): BrowserPanelBounds { if (!value || typeof value !== 'object') throw new AppError('browser_bounds_invalid', '浏览器边界无效', true); const item = value as Record<string, unknown>; for (const key of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight']) if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) throw new AppError('browser_bounds_invalid', '浏览器边界无效', true); return { x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number, viewportWidth: item.viewportWidth as number, viewportHeight: item.viewportHeight as number, visible: item.visible === true } }
