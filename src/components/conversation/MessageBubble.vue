<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from './markdown'
import { useI18n } from '../../services/i18n'

const props = defineProps<{ role: 'user' | 'assistant'; text: string; streaming?: boolean }>()
const html = computed(() => props.role === 'assistant' ? renderMarkdown(props.text) : '')
const { t } = useI18n()
</script>

<template>
  <article class="message" :class="role">
    <div v-if="role === 'user'" class="body user-bubble">
      <div class="plain">{{ text }}</div>
      <span v-if="streaming" class="cursor" :aria-label="t('generating')" />
    </div>
    <div v-if="role === 'user'" class="avatar" aria-hidden="true">{{ t('you') }}</div>
    <div v-else class="body assistant-content">
      <div class="markdown" v-html="html" />
      <span v-if="streaming" class="cursor" :aria-label="t('generating')" />
    </div>
  </article>
</template>

<style scoped>
.message { display: flex; width: 100%; padding: 11px 0; }.message.user { align-items: flex-start; justify-content: flex-end; gap: 9px; }.message.assistant { justify-content: flex-start; }.avatar { display: grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border-radius: 8px; background: var(--surface-raised); color: var(--text-secondary); font-size: 10px; font-weight: 700; }.body { min-width: 0; line-height: 1.7; }.user-bubble { max-width: min(74%, 620px); padding: 9px 13px; border: 1px solid var(--border-faint); border-radius: 15px 15px 5px 15px; background: var(--surface-user); color: var(--text-primary); box-shadow: var(--shadow-user); }.assistant-content { width: 100%; padding: 5px 36px 5px 0; color: var(--text-primary); }.plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.markdown :deep(p) { margin: 0 0 13px; }.markdown :deep(p:last-child) { margin-bottom: 0; }.markdown :deep(pre) { overflow: auto; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 9px; background: var(--surface-code); font-family: var(--font-mono); font-size: 12px; }.markdown :deep(code) { padding: 1px 4px; border-radius: 4px; background: var(--surface-inset); font-family: var(--font-mono); color: var(--text-code); }.markdown :deep(pre code) { padding: 0; background: none; }.markdown :deep(a) { color: var(--text-link); }.markdown :deep(ul), .markdown :deep(ol) { padding-left: 22px; }
.cursor { display: inline-block; width: 6px; height: 15px; margin-left: 3px; vertical-align: -2px; background: var(--accent); animation: blink 1s steps(1) infinite; }@keyframes blink { 50% { opacity: 0; } }
@media (max-width: 720px) { .user-bubble { max-width: 84%; }.assistant-content { padding-right: 8px; } }
</style>
