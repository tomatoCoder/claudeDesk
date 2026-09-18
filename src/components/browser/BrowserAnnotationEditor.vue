<script setup lang="ts">
import { ref, watch } from 'vue'
import type { BrowserAnnotation } from '../../services/browserAnnotations'
const props = defineProps<{ annotation: BrowserAnnotation }>()
const emit = defineEmits<{ update: [id: string, comment: string]; remove: [id: string] }>()
const comment = ref(props.annotation.comment)
watch(() => props.annotation.comment, value => { comment.value = value })
</script>

<template>
  <article class="annotation" :class="{ stale: annotation.status === 'stale' }">
    <header><code>{{ annotation.kind === 'text' ? '文字' : annotation.tagName }}</code><span>{{ annotation.status === 'stale' ? '目标已失效' : annotation.text || annotation.selector }}</span><button type="button" @click="emit('remove', annotation.id)">删除</button></header>
    <textarea v-model="comment" rows="2" placeholder="描述希望如何修改…" @blur="emit('update', annotation.id, comment)" />
  </article>
</template>

<style scoped>
.annotation { padding: 8px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-root); }.annotation.stale { border-color: var(--warning-border); }.annotation header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11px; }.annotation header span { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; }.annotation header button { border: 0; background: none; color: var(--text-muted); cursor: pointer; }.annotation textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 6px 7px; border: 1px solid var(--border-subtle); border-radius: 6px; outline: 0; background: var(--surface-code); color: var(--text-primary); font: 11px var(--font-sans); }.annotation textarea:focus { border-color: var(--accent); }
</style>
