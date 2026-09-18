export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  visible: boolean
}

export interface BrowserPageState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
}

export interface BrowserTarget {
  selector: string
  tagName: string
  text: string
  fingerprint: string
  kind: 'element' | 'text'
  url: string
  title: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface BrowserAnnotation extends BrowserTarget {
  id: string
  taskId: string
  comment: string
  status: 'active' | 'stale'
  createdAt: string
}
