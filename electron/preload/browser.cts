import { ipcRenderer } from 'electron'

let enabled = false
let hovered: HTMLElement | null = null
const marked = new Set<HTMLElement>()

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
function clearHover() { if (hovered) hovered.style.removeProperty('outline'); hovered = null }
function onMove(event: MouseEvent) {
  if (!enabled) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target || target === hovered) return
  clearHover(); hovered = target; hovered.style.setProperty('outline', '2px solid #7c5cff', 'important')
}
function onClick(event: MouseEvent) {
  if (!enabled || !(event.target instanceof HTMLElement)) return
  event.preventDefault(); event.stopPropagation()
  const target = event.target; const rect = target.getBoundingClientRect()
  const selected = getSelection()?.toString().replace(/\s+/g, ' ').trim().slice(0, 500)
  const fingerprint = textOf(target)
  ipcRenderer.send('browser-annotation-selected', { selector: selectorFor(target), tagName: target.tagName.toLowerCase(), text: selected || fingerprint, fingerprint, kind: selected ? 'text' : 'element', url: location.href, title: document.title, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
}
window.addEventListener('mousemove', onMove, true)
window.addEventListener('click', onClick, true)
ipcRenderer.on('browser-annotation-mode', (_event, value: boolean) => { enabled = value; if (!enabled) clearHover() })
ipcRenderer.on('browser-annotation-markers', (_event, annotations: Array<{ id: string; selector: string; tagName: string; fingerprint: string; status: string }>) => {
  for (const element of marked) { element.style.removeProperty('box-shadow'); element.removeAttribute('data-claude-desk-annotation') }
  marked.clear(); const stale: string[] = []
  for (const annotation of annotations) {
    const matches = [...document.querySelectorAll(annotation.selector)]
    const element = matches.length === 1 && matches[0] instanceof HTMLElement ? matches[0] : null
    const currentText = element ? textOf(element) : ''
    if (!element || element.tagName.toLowerCase() !== annotation.tagName || currentText !== annotation.fingerprint) { stale.push(annotation.id); continue }
    element.dataset.claudeDeskAnnotation = annotation.id
    element.style.setProperty('box-shadow', 'inset 0 0 0 2px #f59e0b', 'important'); marked.add(element)
  }
  if (stale.length) ipcRenderer.send('browser-annotation-stale', stale)
})
