<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from './markdown'

const props = defineProps<{ role: 'user' | 'assistant'; text: string; streaming?: boolean }>()
const html = computed(() => props.role === 'assistant' ? renderMarkdown(props.text) : '')
</script>

<template>
  <article class="message" :class="role">
    <div class="avatar" aria-hidden="true">{{ role === 'assistant' ? '✳' : '你' }}</div>
    <div class="body">
      <div v-if="role === 'assistant'" class="markdown" v-html="html" />
      <div v-else class="plain">{{ text }}</div>
      <span v-if="streaming" class="cursor" aria-label="正在生成" />
    </div>
  </article>
</template>

<style scoped>
.message { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 12px; padding: 16px 0; }.avatar { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; background: var(--surface-raised); color: var(--text-secondary); font-size: 11px; font-weight: 700; }.assistant .avatar { color: var(--accent); font-size: 16px; }.body { min-width: 0; padding-top: 4px; line-height: 1.67; }.plain { white-space: pre-wrap; }
.markdown :deep(p) { margin: 0 0 12px; }.markdown :deep(p:last-child) { margin-bottom: 0; }.markdown :deep(pre) { overflow: auto; padding: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: #090908; font-family: var(--font-mono); font-size: 12px; }.markdown :deep(code) { font-family: var(--font-mono); color: #f2c7a6; }.markdown :deep(a) { color: #e9a16c; }.markdown :deep(ul), .markdown :deep(ol) { padding-left: 22px; }
.cursor { display: inline-block; width: 6px; height: 15px; margin-left: 3px; vertical-align: -2px; background: var(--accent); animation: blink 1s steps(1) infinite; }@keyframes blink { 50% { opacity: 0; } }
</style>
