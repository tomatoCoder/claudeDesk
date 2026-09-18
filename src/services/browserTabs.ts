export interface BrowserTab {
  id: string
  title: string
  url: string
  loaded: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string
}

export function createBrowserTab(): BrowserTab {
  return { id: crypto.randomUUID(), title: '新标签页', url: '', loaded: false, loading: false, canGoBack: false, canGoForward: false, error: '' }
}
