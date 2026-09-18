export interface BrowserAnnotation {
  id: string
  taskId: string
  url: string
  title: string
  selector: string
  tagName: string
  text: string
  fingerprint: string
  kind: 'element' | 'text'
  rect: { x: number; y: number; width: number; height: number }
  comment: string
  status: 'active' | 'stale'
  createdAt: string
}

export function formatBrowserAnnotations(annotations: BrowserAnnotation[]) {
  const ready = annotations.filter(value => value.comment.trim())
  if (!ready.length) return ''
  const groups = new Map<string, BrowserAnnotation[]>()
  for (const value of ready) groups.set(value.url, [...(groups.get(value.url) ?? []), value])
  return ['请根据以下网页标注进行修改，并在完成后逐项复核：', ...[...groups].flatMap(([url, values]) => [
    `\n页面：${url}`,
    ...values.map((value, index) => `${index + 1}. [${value.status === 'stale' ? '目标已失效' : value.selector}] ${value.comment.trim()}\n   元素文字：${value.text || '（无）'}`),
  ])].join('\n')
}
