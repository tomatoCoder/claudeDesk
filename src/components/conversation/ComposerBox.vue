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
.composer { margin: 0 auto 18px; width: min(820px, calc(100% - 40px)); overflow: hidden; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-input); box-shadow: var(--shadow-lg); }.composer:focus-within { border-color: rgba(249,115,22,.55); }.composer textarea { display: block; width: 100%; max-height: 220px; resize: none; padding: 15px 16px 6px; border: 0; outline: 0; background: transparent; color: var(--text-primary); line-height: 1.55; }.composer textarea::placeholder { color: var(--text-muted); }.composer-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 7px 9px; }.composer-footer span { margin-right: auto; color: var(--text-muted); font-size: 10px; }.send,.stop { display: grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 9px; cursor: pointer; }.send { background: var(--accent); color: #170a02; }.stop { background: var(--danger); color: white; }.send:disabled { opacity: .35; }
</style>
