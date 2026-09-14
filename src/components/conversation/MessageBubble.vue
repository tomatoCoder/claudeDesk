<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { renderMarkdown } from './markdown'
import { useI18n } from '../../services/i18n'

const props = defineProps<{
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  /** 本轮开始时间（epoch ms），用于运行中的实时耗时。 */
  turnStartedAt?: number
  /** 本轮结束后的总耗时（ms）；null 表示尚未结束。 */
  turnDurationMs?: number | null
}>()
const html = computed(() => props.role === 'assistant' ? renderMarkdown(props.text) : '')
const { t } = useI18n()

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return t('turnDurationHours', { h: hours, m: minutes, s: seconds })
  if (minutes > 0) return t('turnDurationMinutes', { m: minutes, s: seconds })
  return t('turnDurationSeconds', { s: seconds })
}

const now = ref(Date.now())
// 运行中的轮次每秒跳动；结束后 turnDurationMs 固定，定时器随 watchEffect 清理。
watchEffect((onCleanup) => {
  if (props.role !== 'assistant' || props.turnDurationMs != null || !props.turnStartedAt || !props.streaming) return
  const timer = window.setInterval(() => { now.value = Date.now() }, 1000)
  onCleanup(() => window.clearInterval(timer))
})

const durationLabel = computed(() => {
  if (props.role !== 'assistant') return null
  if (props.turnDurationMs != null) return formatDuration(props.turnDurationMs)
  if (props.turnStartedAt && props.streaming && now.value > props.turnStartedAt) return formatDuration(now.value - props.turnStartedAt)
  return null
})
</script>

<template>
  <article class="message" :class="role">
    <div v-if="role === 'user'" class="body user-bubble">
      <div class="plain">{{ text }}</div>
      <span v-if="streaming" class="cursor" :aria-label="t('generating')" />
    </div>
    <div v-else class="body assistant-content">
      <div v-if="durationLabel" class="turn-duration" :title="t('turnDuration')">{{ durationLabel }}</div>
      <div class="markdown" v-html="html" />
      <span v-if="streaming" class="cursor" :aria-label="t('generating')" />
    </div>
  </article>
</template>

<style scoped>
.message { display: flex; width: 100%; padding: 11px 0; }.message.user { align-items: flex-start; justify-content: flex-end; }.message.assistant { justify-content: flex-start; }.body { min-width: 0; line-height: 1.7; }.user-bubble { max-width: min(74%, 620px); padding: 9px 13px; border: 1px solid var(--border-faint); border-radius: 15px 15px 5px 15px; background: var(--surface-user); color: var(--text-primary); box-shadow: var(--shadow-user); line-height: 1.4; }.assistant-content { width: 100%; padding: 5px 36px 5px 0; color: var(--text-primary); }.turn-duration { margin: 0 0 6px; color: var(--text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }.plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.markdown :deep(p) { margin: 0 0 13px; }.markdown :deep(p:last-child) { margin-bottom: 0; }.markdown :deep(pre) { overflow: auto; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 9px; background: var(--surface-code); font-family: var(--font-mono); font-size: 12px; }.markdown :deep(code) { padding: 1px 4px; border-radius: 4px; background: var(--surface-inset); font-family: var(--font-mono); color: var(--text-code); }.markdown :deep(pre code) { padding: 0; background: none; }.markdown :deep(a) { color: var(--text-link); }.markdown :deep(ul), .markdown :deep(ol) { padding-left: 22px; }
.cursor { display: inline-block; width: 6px; height: 15px; margin-left: 3px; vertical-align: -2px; background: var(--accent); animation: blink 1s steps(1) infinite; }@keyframes blink { 50% { opacity: 0; } }
@media (max-width: 720px) { .user-bubble { max-width: 84%; }.assistant-content { padding-right: 8px; } }
</style>
