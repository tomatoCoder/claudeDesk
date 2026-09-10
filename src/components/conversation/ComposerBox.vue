<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUp, Square } from 'lucide-vue-next'

const props = defineProps<{ disabled?: boolean; running?: boolean }>()
const emit = defineEmits<{ send: [text: string]; stop: [] }>()
const text = ref('')

function send() {
  const value = text.value.trim()
  if (!value || props.disabled || props.running) return
  text.value = ''
  emit('send', value)
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send() }
}
</script>

<template>
  <div class="composer">
    <textarea v-model="text" rows="3" :disabled="disabled || running" :placeholder="running ? 'Claude 正在工作…' : '给 Claude Code 发送任务…'" aria-label="发送消息" @keydown="keydown" />
    <div class="composer-footer"><span>⌘/Ctrl + Enter 发送</span><button v-if="running" class="stop" type="button" title="停止任务" @click="emit('stop')"><Square :size="14" /></button><button v-else class="send" type="button" :disabled="disabled || !text.trim()" title="发送" @click="send"><ArrowUp :size="17" /></button></div>
  </div>
</template>

<style scoped>
.composer { width: min(860px, calc(100% - 48px)); margin: 0 auto 17px; overflow: hidden; border: 1px solid #3a352f; border-radius: 18px; background: #151411; box-shadow: 0 20px 65px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.018) inset; transition: border-color .16s ease, box-shadow .16s ease; }.composer:focus-within { border-color: rgba(249,115,22,.58); box-shadow: 0 20px 65px rgba(0,0,0,.5), 0 0 0 1px rgba(249,115,22,.1); }.composer textarea { display: block; width: 100%; min-height: 74px; max-height: 220px; resize: none; padding: 16px 17px 5px; border: 0; outline: 0; background: transparent; color: var(--text-primary); line-height: 1.55; }.composer textarea::placeholder { color: #777169; }.composer-footer { display: flex; min-height: 42px; align-items: center; justify-content: flex-end; gap: 10px; padding: 5px 9px 8px 16px; }.composer-footer span { margin-right: auto; color: var(--text-muted); font-size: 10px; }.send,.stop { display: grid; width: 31px; height: 31px; place-items: center; border: 0; border-radius: 10px; cursor: pointer; transition: transform .14s ease, background .14s ease; }.send { background: var(--accent); color: #170a02; }.send:not(:disabled):hover,.stop:hover { transform: translateY(-1px); }.send:not(:disabled):hover { background: var(--accent-hover); }.stop { background: var(--danger); color: white; }.send:disabled { opacity: .3; }
@media (max-width: 720px) { .composer { width: calc(100% - 28px); margin-bottom: 12px; } }
</style>
