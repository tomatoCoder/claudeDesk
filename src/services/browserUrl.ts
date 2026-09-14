export interface BrowserCommentPayload {
  url: string
  selection: string
  comment: string
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

export function formatBrowserCommentDraft({ url, selection, comment }: BrowserCommentPayload) {
  return `请处理网页评论：${comment}\n\n网址：${url}\n\n选中文本：\n\`\`\`\n${selection}\n\`\`\``
}
