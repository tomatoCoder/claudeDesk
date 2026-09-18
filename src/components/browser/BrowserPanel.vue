<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Globe, Maximize2, MessageSquarePlus, Minimize2, RefreshCw, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'
import type { BrowserAnnotation } from '../../services/browserAnnotations'
import type { BrowserTab } from '../../services/browserTabs'

const props = defineProps<{ width: number; url: string; loaded: boolean; loading: boolean; canGoBack: boolean; canGoForward: boolean; annotationEnabled: boolean; annotations: BrowserAnnotation[]; error: string; tabs: BrowserTab[]; activeTabId: string }>()
const emit = defineEmits<{ close: []; resize: [width: number]; navigate: [url: string]; refresh: []; back: []; forward: []; tabSelect: [id: string]; tabClose: [id: string]; annotationChange: [enabled: boolean]; annotationUpdate: [id: string, comment: string]; annotationStyle: [id: string, style: BrowserAnnotation['style']]; annotationRemove: [id: string]; annotationsInsert: []; annotationsClear: []; boundsChange: [] }>()
const { t } = useI18n()
const address = ref(props.url)
const fullscreen = ref(false)
const addressInput = ref<HTMLInputElement | null>(null)
const webviewHost = ref<HTMLElement | null>(null)
let resizeStart: { x: number; width: number } | null = null
let boundsObserver: ResizeObserver | null = null

const displayAddress = computed({ get: () => address.value, set: (value: string) => { address.value = value } })
watch(() => props.url, (value) => { address.value = value })

function navigate() { emit('navigate', address.value) }
function startResize(event: PointerEvent) {
  resizeStart = { x: event.clientX, width: props.width }
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize)
}
function resize(event: PointerEvent) {
  if (!resizeStart) return
  emit('resize', Math.min(960, Math.max(420, resizeStart.width + resizeStart.x - event.clientX)))
}
function stopResize() {
  resizeStart = null
  window.removeEventListener('pointermove', resize)
  window.removeEventListener('pointerup', stopResize)
}
async function toggleFullscreen(value = !fullscreen.value) { fullscreen.value = value; await nextTick(); emit('boundsChange') }
function handleKeydown(event: KeyboardEvent) { if (event.key !== 'Escape') return; if (fullscreen.value) void toggleFullscreen(false); else addressInput.value?.blur() }
async function focusAddress() { await nextTick(); addressInput.value?.focus() }
function webviewBounds() {
  const rect = webviewHost.value?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (!webviewHost.value) return
  boundsObserver = new ResizeObserver(() => emit('boundsChange'))
  boundsObserver.observe(webviewHost.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopResize()
  boundsObserver?.disconnect()

})
defineExpose({ focusAddress, webviewBounds })
</script>

<template>
  <aside class="browser-panel" :class="{ fullscreen }" :style="{ width: `${width}px` }">
    <div class="browser-resizer" @pointerdown="startResize" />
    <header class="browser-header">
      <div class="browser-title" :title="t('browser')"><Globe :size="15" /></div>
      <button class="annotation-button" :class="{ active: annotationEnabled }" type="button" :disabled="!loaded || loading" :title="t('browserAnnotate')" @click="emit('annotationChange', !annotationEnabled)"><MessageSquarePlus :size="15" /><span>{{ t('annotate') }}</span></button>
      <div class="browser-tabs" role="tablist" aria-label="浏览器标签页">
        <button v-for="tab in tabs" :key="tab.id" class="browser-tab" :class="{ active: tab.id === activeTabId }" type="button" role="tab" :aria-selected="tab.id === activeTabId" :title="tab.title" @click="emit('tabSelect', tab.id)"><i v-if="tab.loading" aria-hidden="true" /><span>{{ tab.title || '新标签页' }}</span><X :size="13" role="button" aria-label="关闭标签页" @click.stop="emit('tabClose', tab.id)" /></button>
      </div>
      <button class="icon-button" type="button" :title="fullscreen ? '退出全屏' : '全屏显示'" :aria-label="fullscreen ? '退出全屏' : '全屏显示'" :aria-pressed="fullscreen" @click="toggleFullscreen()"><Minimize2 v-if="fullscreen" :size="16" /><Maximize2 v-else :size="16" /></button>
      <button class="icon-button" type="button" :title="t('close')" :aria-label="t('close')" @click="emit('close')"><X :size="17" /></button>
    </header>
    <div class="browser-toolbar">
      <button class="icon-button" type="button" title="后退" aria-label="后退" :disabled="!loaded || !canGoBack" @click="emit('back')"><ArrowLeft :size="15" /></button>
      <button class="icon-button" type="button" title="前进" aria-label="前进" :disabled="!loaded || !canGoForward" @click="emit('forward')"><ArrowRight :size="15" /></button>
      <button class="icon-button" type="button" :title="t('refresh')" :aria-label="t('refresh')" :disabled="!loaded" @click="emit('refresh')"><RefreshCw :size="15" :class="{ spinning: loading }" /></button>
      <form class="browser-address" @submit.prevent="navigate">
        <input ref="addressInput" v-model="displayAddress" :aria-label="t('browserAddress')" :placeholder="t('browserAddress')" spellcheck="false" autocomplete="off" @focus="addressInput?.select()" />
        <button type="submit" class="icon-button" title="打开网址" aria-label="打开网址"><ArrowRight :size="15" /></button>
      </form>
    </div>
    <p v-if="error" class="browser-error" role="alert">{{ error }}<button type="button" @click="navigate">重试</button></p>
    <div ref="webviewHost" class="browser-webview-host">
      <div v-if="!loaded" class="browser-empty"><Globe :size="24" /><strong>{{ t('browserStartTitle') }}</strong><span>{{ t('browserStartHelp') }}</span></div>
      <div v-else-if="loading" class="browser-loading-hint">{{ t('browserLoading') }}</div>
    </div>

  </aside>
</template>

<style scoped>
.browser-panel { position: relative; z-index: 7; display: flex; min-width: 340px; max-width: min(960px, calc(100vw - var(--sidebar-width, 280px) - 260px)); min-height: 0; flex-direction: column; border-left: 1px solid var(--border-subtle); background: var(--surface-root); container-type: inline-size; }
.browser-panel.fullscreen { position: fixed; z-index: 100; inset: 0; width: 100vw !important; max-width: none; height: 100vh; border-left: 0; }
.browser-panel.fullscreen .browser-resizer { display: none; }
.browser-resizer { position: absolute; z-index: 3; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; }
.browser-header { display: flex; min-height: 42px; flex: 0 0 42px; align-items: center; gap: 5px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }
.browser-title { display: flex; flex: none; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
.browser-tabs { display: flex; min-width: 0; flex: 1; gap: 3px; overflow-x: auto; padding: 0 2px; scrollbar-width: none; }.browser-tabs::-webkit-scrollbar { display: none; }.browser-tab { display: flex; min-width: 64px; max-width: 160px; height: 30px; flex: 1 1 148px; align-items: center; gap: 6px; padding: 0 7px 0 9px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 11px; transition: background .14s ease, border-color .14s ease, color .14s ease; }.browser-tab:hover { background: var(--surface-hover); color: var(--text-secondary); }.browser-tab.active { border-color: var(--border-subtle); background: var(--surface-root); color: var(--text-primary); box-shadow: 0 1px 2px color-mix(in srgb, #000 7%, transparent); }.browser-tab span { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }.browser-tab svg { flex: none; border-radius: 4px; opacity: 0; transition: opacity .14s ease, background .14s ease; }.browser-tab:hover svg,.browser-tab.active svg { opacity: 1; }.browser-tab svg:hover { background: var(--surface-hover); }.browser-tab i { width: 8px; height: 8px; flex: none; border: 1px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
.browser-toolbar { display: flex; flex: 0 0 40px; align-items: center; gap: 3px; padding: 0 8px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }
.browser-address { display: flex; min-width: 0; flex: 1; align-items: center; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--surface-root); }
.browser-address:focus-within { border-color: color-mix(in srgb, var(--accent) 58%, var(--border-strong)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent); }
.browser-address input { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px 8px; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: 12px var(--font-sans); }
.icon-button,.annotation-button { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 7px; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 11px; }
.icon-button { width: 28px; padding: 0; }
.icon-button:hover,.annotation-button:hover,.annotation-button.active { background: var(--surface-hover); color: var(--text-primary); }
.annotation-button.active { color: var(--accent); }
.icon-button:disabled,.annotation-button:disabled { opacity: .4; cursor: default; }
.browser-webview-host { position: relative; min-height: 0; flex: 1; overflow: hidden; background: var(--surface-code); }
.browser-empty,.browser-loading-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); font-size: 11px; }
.browser-empty { flex-direction: column; padding: 16px; text-align: center; }
.browser-empty strong { color: var(--text-secondary); }
.browser-error { flex: none; margin: 0; padding: 9px 12px; color: var(--text-danger); font-size: 12px; overflow-wrap: anywhere; }
.browser-error button { margin-left: 8px; cursor: pointer; }
.spinning { animation: spin 1s linear infinite; }
@container (max-width: 560px) { .annotation-button span { display: none; }.annotation-button { width: 28px; padding: 0; }.browser-tab { min-width: 56px; flex-basis: 112px; } }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
