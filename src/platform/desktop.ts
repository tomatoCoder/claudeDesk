export type Unlisten = () => void

export interface OpenFilesOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
}

export interface DesktopPlatform {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>
  openFiles(options: OpenFilesOptions): Promise<string | string[] | null>
  filePath?(file: File): string
}

declare global {
  interface Window {
    claudeDeskDesktop?: DesktopPlatform
  }
}

let installedPlatform: DesktopPlatform | undefined

export const desktop: DesktopPlatform = {
  invoke: (command, args) => platform().invoke(command, args),
  listen: (event, handler) => platform().listen(event, handler),
  openFiles: (options) => platform().openFiles(options),
  filePath: (file) => platform().filePath?.(file) ?? (file as File & { path?: string }).path ?? '',
}

export function installDesktopPlatform(value: DesktopPlatform) {
  installedPlatform = value
}

export function isDesktopPlatformAvailable() {
  return !!installedPlatform || !!window.claudeDeskDesktop
}

function platform() {
  const value = installedPlatform ?? window.claudeDeskDesktop
  if (!value) throw new Error('Electron 桌面接口不可用')
  return value
}
