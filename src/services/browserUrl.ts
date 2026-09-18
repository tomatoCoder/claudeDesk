import type { BrowserAnnotation } from './browserAnnotations'

export interface BrowserCommentPayload {
  url: string
  selection: string
  comment: string
  style?: BrowserAnnotation['style']
  originalStyle?: Record<string, string | number | number[]>
  selector?: string
  tagName?: string
}

export function browserStyleChanges(payload: BrowserCommentPayload) {
  if (!payload.style || !payload.originalStyle) return []
  const labels: Record<string, string> = { color: 'color', backgroundColor: 'background-color', opacity: 'opacity', fontFamily: 'font-family', fontSize: 'font-size', fontWeight: 'font-weight', width: 'width', height: 'height', padding: 'padding', margin: 'margin', borderRadius: 'border-radius', borderColor: 'border-color', borderWidth: 'border-width' }
  const units = new Set(['fontSize', 'width', 'height', 'borderRadius', 'borderWidth'])
  return Object.entries(payload.style).flatMap(([key, next]) => {
    const previous = payload.originalStyle?.[key]
    const before = Array.isArray(previous) ? previous.map(value => `${value}px`).join(' ') : `${previous ?? ''}${units.has(key) && Number(previous) ? 'px' : ''}`
    const after = Array.isArray(next) ? next.map(value => `${value}px`).join(' ') : `${next}${units.has(key) && Number(next) ? 'px' : ''}`
    return before === after || (!Number(next) && ['width', 'height'].includes(key)) ? [] : [{ property: labels[key] ?? key, before, after }]
  })
}

const MAX_URL_LENGTH = 4096

export function normalizeBrowserUrl(value: string) {
  const raw = value.trim()
  if (!raw) throw new Error('请输入网址')
  if (raw.length > MAX_URL_LENGTH) throw new Error('网址过长')
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(raw)
  const candidate = local ? `http://${raw}` : /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(candidate) }
  catch { throw new Error('网址格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 http 或 https 网址')
  return url.toString()
}

export function formatBrowserCommentDraft(payload: BrowserCommentPayload) {
  const changes = browserStyleChanges(payload)
  const styleText = changes.length ? `\n\n样式修改：\n${changes.map(change => `- ${change.property}: ${change.before} -> ${change.after}`).join('\n')}` : ''
  return `请处理网页评论：${payload.comment}${styleText}\n\n网址：${payload.url}\n目标：${payload.selector ?? payload.tagName ?? '元素'}\n\n选中文本：\n\`\`\`\n${payload.selection}\n\`\`\``
}
