import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { open as tauriOpen } from '@tauri-apps/plugin-dialog'

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
}

declare global {
  interface Window {
    claudeDeskDesktop?: DesktopPlatform
    __TAURI_INTERNALS__?: unknown
  }
}

const tauriPlatform: DesktopPlatform = {
  invoke: (command, args) => tauriInvoke(command, args),
  listen: async (event, handler) => tauriListen(event, ({ payload }) => handler(payload as never)),
  openFiles: (options) => tauriOpen(options),
}

let installedPlatform: DesktopPlatform | undefined

export const desktop: DesktopPlatform = {
  invoke: (command, args) => platform().invoke(command, args),
  listen: (event, handler) => platform().listen(event, handler),
  openFiles: (options) => platform().openFiles(options),
}

export function installDesktopPlatform(value: DesktopPlatform) {
  installedPlatform = value
}

export function isDesktopPlatformAvailable() {
  return !!installedPlatform || !!window.claudeDeskDesktop || '__TAURI_INTERNALS__' in window
}

function platform() {
  return installedPlatform ?? window.claudeDeskDesktop ?? tauriPlatform
}

