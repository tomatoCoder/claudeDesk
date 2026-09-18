import { ipcRenderer } from 'electron'

let enabled = false
let hovered: HTMLElement | null = null
let selected: HTMLElement | null = null
const marked = new Set<HTMLElement>()
let editor: HTMLDivElement | null = null
let editorTarget: { selector: string; tagName: string; text: string; fingerprint: string; kind: 'element' | 'text'; url: string; title: string; rect: { x: number; y: number; width: number; height: number }; originalStyle: Record<string, string | number | number[]> } | null = null
const outlines = new WeakMap<HTMLElement, { value: string; priority: string; offset: string; offsetPriority: string }>()

function selectorFor(element: HTMLElement) {
  if (element.id) return `#${CSS.escape(element.id)}`
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== document.body && parts.length < 6) {
    let part = current.tagName.toLowerCase()
    const parent: HTMLElement | null = current.parentElement
    if (parent) {
      const peers = [...parent.children].filter(item => item.tagName === current!.tagName)
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(current) + 1})`
    }
    parts.unshift(part); current = parent
  }
  return `body > ${parts.join(' > ')}`
}
function textOf(element: HTMLElement) { return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500) }
function colorHex(value: string) { const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number); return values?.length === 3 ? `#${values.map(item => Math.max(0, Math.min(255, Math.round(item))).toString(16).padStart(2, '0')).join('')}` : value.startsWith('#') ? value.slice(0, 7) : '#000000' }
function showOutline(element: HTMLElement) {
  if (!outlines.has(element)) outlines.set(element, { value: element.style.getPropertyValue('outline'), priority: element.style.getPropertyPriority('outline'), offset: element.style.getPropertyValue('outline-offset'), offsetPriority: element.style.getPropertyPriority('outline-offset') })
  element.style.setProperty('outline', '2px solid #1677ff', 'important')
  element.style.setProperty('outline-offset', '-2px', 'important')
}
function restoreOutline(element: HTMLElement) {
  const outline = outlines.get(element)
  if (outline?.value) element.style.setProperty('outline', outline.value, outline.priority)
  else element.style.removeProperty('outline')
  if (outline?.offset) element.style.setProperty('outline-offset', outline.offset, outline.offsetPriority)
  else element.style.removeProperty('outline-offset')
  outlines.delete(element)
}
function clearHover() { if (hovered && hovered !== selected) restoreOutline(hovered); hovered = null }
function clearSelected() { if (selected) restoreOutline(selected); selected = null }
function closeEditor() { editor?.remove(); editor = null; editorTarget = null; clearSelected(); clearHover() }
function onMove(event: MouseEvent) {
  if (!enabled) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target || editor?.contains(target) || target === hovered) return
  clearHover(); hovered = target; showOutline(target)
}
function onClick(event: MouseEvent) {
  if (!enabled || !(event.target instanceof HTMLElement)) return
  if (editor?.contains(event.target)) return
  event.preventDefault(); event.stopPropagation()
  const target = event.target; const rect = target.getBoundingClientRect()
  const selectionText = getSelection()?.toString().replace(/\s+/g, ' ').trim().slice(0, 500)
  const fingerprint = textOf(target)
  const computed = getComputedStyle(target)
  const px = (value: string) => Number.parseFloat(value) || 0
  const originalStyle = { color: colorHex(computed.color), backgroundColor: colorHex(computed.backgroundColor), opacity: px(computed.opacity), fontFamily: computed.fontFamily, fontSize: px(computed.fontSize), fontWeight: computed.fontWeight, width: px(computed.width), height: px(computed.height), padding: [px(computed.paddingTop), px(computed.paddingRight), px(computed.paddingBottom), px(computed.paddingLeft)], margin: [px(computed.marginTop), px(computed.marginRight), px(computed.marginBottom), px(computed.marginLeft)], borderRadius: px(computed.borderRadius), borderColor: colorHex(computed.borderColor), borderWidth: px(computed.borderWidth) }
  closeEditor(); selected = target; showOutline(target); editorTarget = { selector: selectorFor(target), tagName: target.tagName.toLowerCase(), text: selectionText || fingerprint, fingerprint, kind: selectionText ? 'text' : 'element', url: location.href, title: document.title, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, originalStyle }
  editor = document.createElement('div'); editor.style.cssText = `position:fixed;z-index:2147483647;left:${Math.min(Math.max(8, rect.left), innerWidth - 360)}px;top:${Math.min(Math.max(8, rect.bottom + 8), innerHeight - 360)}px;width:340px;padding:10px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;box-shadow:0 8px 30px #0002;color:#374151;font:12px Arial,sans-serif`
  const safeFingerprint = fingerprint.replace(/[&<>\"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[value] || value)
  editor.innerHTML = `<div data-drag-handle style="display:flex;gap:8px;align-items:center;cursor:move;touch-action:none"><span aria-hidden="true" style="color:#9ca3af;letter-spacing:-2px;user-select:none">⋮⋮</span><button data-settings aria-label="展开样式" style="flex:none;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:#f3f4f6;color:#6b7280;cursor:pointer">⚙</button><textarea data-comment rows="1" placeholder="描述这些更改…" style="box-sizing:border-box;flex:1;min-width:0;height:30px;max-height:72px;padding:0;border:0;outline:0;resize:none;overflow-y:auto;font:13px/30px Arial,sans-serif;cursor:text"></textarea><button data-comment-send aria-label="发送评论" style="display:none;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:#111827;color:#fff;cursor:pointer;font-size:15px">✓</button></div><div data-fields style="display:none;margin-top:8px;border-top:1px solid #eee"><div data-scroll style="max-height:330px;overflow-y:auto;padding-right:4px"><div style="padding:8px 0 2px;color:#6b7280">&lt;${target.tagName.toLowerCase()}&gt;</div><label>文本 <input data-text value="${safeFingerprint}"></label><label>文字颜色 <input data-color type="color" value="#000000"><code>rgb(0, 0, 0)</code></label><label>背景 <input data-bg type="color" value="#ffffff"><code>rgb(255, 255, 255)</code></label><label>Opacity <input data-opacity type="number" min="0" max="1" step="0.05" value="1"></label><label>字体 <select data-font><option>Arial</option><option>Helvetica</option><option>Georgia</option><option>monospace</option></select></label><label>字号 <input data-font-size type="number" min="1" max="200" value="16"> px</label><label>字重 <select data-font-weight><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label><label>宽度 <input data-width type="number" min="0" value="0"> px</label><label>高度 <input data-height type="number" min="0" value="0"> px</label><label>内边距 <input data-padding placeholder="上 右 下 左"></label><label>外边距 <input data-margin placeholder="上 右 下 左"></label><label>圆角 <input data-radius type="number" min="0" value="0"> px</label><label>边框颜色 <input data-border-color type="color" value="#000000"></label><label>边框宽度 <input data-border-width type="number" min="0" value="0"> px</label></div><div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #eee;padding-top:8px"><button data-cancel style="height:32px;padding:0 14px;border:1px solid #eee;border-radius:18px;background:#fff;color:#4b5563;cursor:pointer">取消</button><button data-ok disabled aria-label="确认" style="width:34px;height:34px;padding:0;border:0;border-radius:50%;background:#d1d5db;color:#fff;cursor:not-allowed;font-size:16px">✓</button></div></div>`
  editor.querySelectorAll('label').forEach(label => { label.setAttribute('style', 'display:flex;align-items:center;gap:8px;padding:6px 0'); const input = label.querySelector('input,select'); if (input) (input as HTMLElement).setAttribute('style', 'flex:1;min-width:0;padding:6px;border:1px solid #eee;border-radius:8px') })
  document.documentElement.appendChild(editor)
  const setValue = (selector: string, value: string | number) => { const input = editor?.querySelector<HTMLInputElement>(selector); if (input) input.value = String(value) }
  setValue('[data-color]', colorHex(computed.color)); setValue('[data-bg]', colorHex(computed.backgroundColor)); setValue('[data-opacity]', computed.opacity); setValue('[data-font-size]', px(computed.fontSize)); setValue('[data-width]', px(computed.width)); setValue('[data-height]', px(computed.height)); setValue('[data-padding]', originalStyle.padding.join(' ')); setValue('[data-margin]', originalStyle.margin.join(' ')); setValue('[data-radius]', px(computed.borderRadius)); setValue('[data-border-color]', colorHex(computed.borderColor)); setValue('[data-border-width]', px(computed.borderWidth))
  const font = editor.querySelector<HTMLSelectElement>('[data-font]'); if (font) { if (![...font.options].some(option => option.value === computed.fontFamily)) font.add(new Option(computed.fontFamily, computed.fontFamily)); font.value = computed.fontFamily }
  const weight = editor.querySelector<HTMLSelectElement>('[data-font-weight]'); if (weight) { if (![...weight.options].some(option => option.value === computed.fontWeight)) weight.add(new Option(computed.fontWeight, computed.fontWeight)); weight.value = computed.fontWeight }
  const dragHandle = editor.querySelector<HTMLElement>('[data-drag-handle]')
  dragHandle?.addEventListener('pointerdown', event => {
    if (!editor || (event.target instanceof Element && event.target.closest('button,input,select,textarea'))) return
    event.preventDefault(); dragHandle.setPointerCapture(event.pointerId)
    const bounds = editor.getBoundingClientRect(); const offsetX = event.clientX - bounds.left; const offsetY = event.clientY - bounds.top
    const move = (moveEvent: PointerEvent) => { if (!editor) return; const left = Math.min(Math.max(8, moveEvent.clientX - offsetX), Math.max(8, innerWidth - editor.offsetWidth - 8)); const top = Math.min(Math.max(8, moveEvent.clientY - offsetY), Math.max(8, innerHeight - editor.offsetHeight - 8)); editor.style.left = `${left}px`; editor.style.top = `${top}px` }
    const stop = () => { dragHandle.removeEventListener('pointermove', move); dragHandle.removeEventListener('pointerup', stop); dragHandle.removeEventListener('pointercancel', stop) }
    dragHandle.addEventListener('pointermove', move); dragHandle.addEventListener('pointerup', stop); dragHandle.addEventListener('pointercancel', stop)
  })
  const comment = editor.querySelector<HTMLTextAreaElement>('[data-comment]')
  const commentSend = editor.querySelector<HTMLButtonElement>('[data-comment-send]')
  comment?.focus()
  const markDirty = () => { const button = editor?.querySelector<HTMLButtonElement>('[data-ok]'); if (!button) return; button.disabled = false; button.style.background = '#2563eb'; button.style.cursor = 'pointer' }
  const updateComment = () => { if (!comment || !commentSend) return; commentSend.style.display = comment.value.trim() ? 'block' : 'none'; comment.style.height = '30px'; comment.style.height = `${Math.min(72, comment.scrollHeight)}px` }
  editor.addEventListener('input', event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) markDirty(); if (event.target === comment) updateComment() })
  editor.addEventListener('change', event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) markDirty() })
  editor.querySelector('[data-settings]')?.addEventListener('click', () => { const fields = editor?.querySelector<HTMLElement>('[data-fields]'); if (!fields) return; const expanded = fields.style.display !== 'none'; fields.style.display = expanded ? 'none' : 'block'; editor?.querySelector('[data-settings]')?.setAttribute('aria-label', expanded ? '展开样式' : '收起样式') })
  editor.querySelector('[data-cancel]')?.addEventListener('click', closeEditor)
  const submit = () => { if (!editorTarget) return; const value = (selector: string) => editor?.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value || ''; const box = (selector: string) => value(selector).split(/[ ,]+/).map(Number).filter(Number.isFinite).slice(0, 4); const four = (selector: string) => { const values = box(selector); return [values[0] || 0, values[1] || values[0] || 0, values[2] || values[0] || 0, values[3] || values[1] || values[0] || 0] }; ipcRenderer.send('browser-annotation-selected', { ...editorTarget, text: value('[data-text]') || editorTarget.text, comment: value('[data-comment]').trim(), style: { color: value('[data-color]') || '#000000', backgroundColor: value('[data-bg]') || '#ffffff', opacity: Number(value('[data-opacity]') || 1), fontFamily: editor?.querySelector<HTMLSelectElement>('[data-font]')?.value || 'Arial', fontSize: Number(value('[data-font-size]') || 16), fontWeight: editor?.querySelector<HTMLSelectElement>('[data-font-weight]')?.value || '400', width: Number(value('[data-width]') || 0), height: Number(value('[data-height]') || 0), padding: four('[data-padding]'), margin: four('[data-margin]'), borderRadius: Number(value('[data-radius]') || 0), borderColor: value('[data-border-color]') || '#000000', borderWidth: Number(value('[data-border-width]') || 0) } }); closeEditor() }
  commentSend?.addEventListener('click', () => { if (comment?.value.trim()) submit() })
  comment?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && comment.value.trim()) { event.preventDefault(); submit() } })
  editor.querySelector('[data-ok]')?.addEventListener('click', submit)
}
window.addEventListener('mousemove', onMove, true)
window.addEventListener('click', onClick, true)
window.addEventListener('keydown', event => { if (enabled && event.key === 'Escape') { event.preventDefault(); closeEditor() } }, true)
ipcRenderer.on('browser-annotation-mode', (_event, value: boolean) => { enabled = value; if (!enabled) { clearHover(); closeEditor() } })
ipcRenderer.on('browser-annotation-markers', (_event, annotations: Array<{ id: string; selector: string; tagName: string; fingerprint: string; status: string; style?: { color: string; backgroundColor: string; opacity: number; fontFamily: string; fontSize: number; fontWeight: string; width: number; height: number; padding: number[]; margin: number[]; borderRadius: number; borderColor: string; borderWidth: number } }>) => {
  for (const element of marked) { element.style.removeProperty('box-shadow'); element.removeAttribute('data-claude-desk-annotation') }
  marked.clear(); const stale: string[] = []
  for (const annotation of annotations) {
    const matches = [...document.querySelectorAll(annotation.selector)]
    const element = matches.length === 1 && matches[0] instanceof HTMLElement ? matches[0] : null
    const currentText = element ? textOf(element) : ''
    if (!element || element.tagName.toLowerCase() !== annotation.tagName || currentText !== annotation.fingerprint) { stale.push(annotation.id); continue }
    element.dataset.claudeDeskAnnotation = annotation.id
    marked.add(element)
    if (annotation.style) {
      element.style.setProperty('color', annotation.style.color, 'important')
      element.style.setProperty('background-color', annotation.style.backgroundColor, 'important')
      element.style.setProperty('opacity', String(annotation.style.opacity), 'important')
      element.style.setProperty('font-family', annotation.style.fontFamily, 'important')
      element.style.setProperty('font-size', `${annotation.style.fontSize}px`, 'important')
      element.style.setProperty('font-weight', annotation.style.fontWeight, 'important')
      if (annotation.style.width) element.style.setProperty('width', `${annotation.style.width}px`, 'important')
      if (annotation.style.height) element.style.setProperty('height', `${annotation.style.height}px`, 'important')
      element.style.setProperty('padding', annotation.style.padding.map(value => `${value}px`).join(' '), 'important')
      element.style.setProperty('margin', annotation.style.margin.map(value => `${value}px`).join(' '), 'important')
      element.style.setProperty('border-radius', `${annotation.style.borderRadius}px`, 'important')
      element.style.setProperty('border-color', annotation.style.borderColor, 'important')
      element.style.setProperty('border-width', `${annotation.style.borderWidth}px`, 'important')
    }
  }
  if (stale.length) ipcRenderer.send('browser-annotation-stale', stale)
})
