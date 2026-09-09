<script setup lang="ts">
import { Copy, RefreshCw, X } from 'lucide-vue-next'
defineProps<{ content: string; loading?: boolean }>()
defineEmits<{ close: []; refresh: [] }>()
async function copy(content: string) { await navigator.clipboard.writeText(content) }
</script>

<template><aside class="log-drawer"><header><div><strong>原始日志</strong><small>最多保留每个任务最近 5 MiB</small></div><button class="icon-button" type="button" title="复制" @click="copy(content)"><Copy :size="15" /></button><button class="icon-button" type="button" title="刷新" @click="$emit('refresh')"><RefreshCw :size="15" /></button><button class="icon-button" type="button" title="关闭" @click="$emit('close')"><X :size="17" /></button></header><pre>{{ loading ? '读取中…' : (content || '暂无日志') }}</pre></aside></template>

<style scoped>
.log-drawer { position: absolute; inset: 58px 0 0 auto; z-index: 10; display: flex; width: min(620px, 75%); flex-direction: column; border-left: 1px solid var(--border-strong); background: #090908; box-shadow: var(--shadow-lg); }.log-drawer header { display: flex; align-items: center; gap: 3px; height: 52px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border-subtle); }.log-drawer header div { flex: 1; }.log-drawer strong,.log-drawer small { display: block; }.log-drawer small { color: var(--text-muted); font-size: 10px; }.log-drawer pre { flex: 1; overflow: auto; margin: 0; padding: 14px; white-space: pre-wrap; color: #b9b2a8; font: 10px/1.55 var(--font-mono); }
</style>
