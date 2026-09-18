<script setup lang="ts">
import type { BrowserAnnotation } from '../../services/browserAnnotations'
import BrowserAnnotationEditor from './BrowserAnnotationEditor.vue'
defineProps<{ annotations: BrowserAnnotation[] }>()
const emit = defineEmits<{ update: [id: string, comment: string]; remove: [id: string]; insert: []; clear: [] }>()
function update(id: string, comment: string) { emit('update', id, comment) }
</script>

<template>
  <section class="annotation-list">
    <div class="annotation-summary"><span>{{ annotations.length }} 条标注</span><button type="button" :disabled="!annotations.some(value => value.comment.trim())" @click="emit('insert')">加入对话</button><button type="button" :disabled="!annotations.length" @click="emit('clear')">清空</button></div>
    <div v-if="annotations.length" class="annotation-scroll"><BrowserAnnotationEditor v-for="annotation in annotations" :key="annotation.id" :annotation="annotation" @update="update" @remove="emit('remove', $event)" /></div>
    <p v-else>开启标注后，点击页面元素添加评论。</p>
  </section>
</template>

<style scoped>
.annotation-list { flex: 0 0 auto; max-height: 240px; padding: 8px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }.annotation-summary { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; color: var(--text-muted); font-size: 11px; }.annotation-summary span { flex: 1; }.annotation-summary button { padding: 4px 7px; border: 1px solid var(--border-subtle); border-radius: 6px; background: var(--surface-root); color: var(--text-secondary); cursor: pointer; }.annotation-summary button:disabled { opacity: .45; cursor: default; }.annotation-scroll { display: grid; max-height: 185px; gap: 6px; overflow: auto; }.annotation-list > p { margin: 4px 0; color: var(--text-muted); font-size: 11px; text-align: center; }
</style>
