import { AppError } from '../../shared/errors.js'

export function normalizeBrowserUrl(value: string) {
  const raw = value.trim()
  if (!raw) throw new AppError('browser_url_required', '请输入网址', true)
  if (raw.length > 4096) throw new AppError('browser_url_too_long', '网址过长', true)
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(raw)
  const candidate = local ? `http://${raw}` : /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try { url = new URL(candidate) } catch { throw new AppError('browser_url_invalid', '网址格式无效', true) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('browser_url_scheme', '仅支持 http 或 https 网址', true)
  return url.toString()
}

export function isAllowedNavigation(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
