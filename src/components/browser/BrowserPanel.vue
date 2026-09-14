<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Globe, MessageSquarePlus, RefreshCw, X } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'

const props = defineProps<{ width: number; url: string; loaded: boolean; loading: boolean; annotationEnabled: boolean; error: string }>()
const emit = defineEmits<{ close: []; resize: [width: number]; navigate: [url: string]; refresh: []; back: []; forward: []; annotationChange: [enabled: boolean]; boundsChange: [] }>()
const { t } = useI18n()
const address = ref(props.url)
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
function handleKeydown(event: KeyboardEvent) { if (event.key === 'Escape') addressInput.value?.blur() }
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
  if (!webviewHost.value) return
  boundsObserver = new ResizeObserver(() => emit('boundsChange'))
  boundsObserver.observe(webviewHost.value)
})
onBeforeUnmount(() => {
  stopResize()
  boundsObserver?.disconnect()

})
defineExpose({ focusAddress, webviewBounds })
</script>

<template>
  <aside class="browser-panel" :style="{ width: `${width}px` }" @keydown="handleKeydown">
    <div class="browser-resizer" @pointerdown="startResize" />
    <header class="browser-header">
      <div class="browser-title"><Globe :size="15" /><strong>{{ t('browser') }}</strong></div>
      <button class="annotation-button" :class="{ active: annotationEnabled }" type="button" :disabled="!loaded || loading" :title="t('browserAnnotate')" @click="emit('annotationChange', !annotationEnabled)"><MessageSquarePlus :size="15" />{{ t('annotate') }}</button>
      <button class="icon-button" type="button" :title="t('close')" :aria-label="t('close')" @click="emit('close')"><X :size="17" /></button>
    </header>
    <div class="browser-toolbar">
      <button class="icon-button" type="button" title="后退" aria-label="后退" :disabled="!loaded" @click="emit('back')"><ArrowLeft :size="15" /></button>
      <button class="icon-button" type="button" title="前进" aria-label="前进" :disabled="!loaded" @click="emit('forward')"><ArrowRight :size="15" /></button>
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
.browser-panel { position: relative; z-index: 7; display: flex; min-width: 340px; max-width: min(960px, calc(100vw - var(--sidebar-width, 280px) - 260px)); min-height: 0; flex-direction: column; border-left: 1px solid var(--border-subtle); background: var(--surface-root); }
.browser-resizer { position: absolute; z-index: 3; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; }
.browser-header { display: flex; min-height: 42px; flex: 0 0 42px; align-items: center; gap: 6px; padding: 0 8px 0 13px; background: var(--surface-header); }
.browser-title { display: flex; flex: 1; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
.browser-toolbar { display: flex; flex: 0 0 46px; align-items: center; gap: 4px; padding: 0 8px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }
.browser-address { display: flex; min-width: 0; flex: 1; align-items: center; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--surface-root); }
.browser-address:focus-within { border-color: var(--accent); }
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
@keyframes spin { to { transform: rotate(360deg); } }
</style>
