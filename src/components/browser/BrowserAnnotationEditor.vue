<script setup lang="ts">
import { ref, watch } from 'vue'
import type { BrowserAnnotation } from '../../services/browserAnnotations'
const props = defineProps<{ annotation: BrowserAnnotation }>()
const emit = defineEmits<{ update: [id: string, comment: string]; remove: [id: string]; style: [id: string, style: BrowserAnnotation['style']] }>()
const comment = ref(props.annotation.comment)
const styleOpen = ref(false)
const style = ref({ ...props.annotation.style })
watch(() => props.annotation.comment, value => { comment.value = value })
watch(() => props.annotation.style, value => { style.value = { ...value } })
function saveStyle() { emit('style', props.annotation.id, { ...style.value }); styleOpen.value = false }
</script>

<template>
  <article class="annotation" :class="{ stale: annotation.status === 'stale' }">
    <header><code>{{ annotation.kind === 'text' ? '文字' : annotation.tagName }}</code><span>{{ annotation.status === 'stale' ? '目标已失效' : annotation.text || annotation.selector }}</span><button type="button" @click="styleOpen = !styleOpen">调整</button><button type="button" @click="emit('remove', annotation.id)">删除</button></header>
    <textarea v-model="comment" rows="2" placeholder="描述希望如何修改…" @blur="emit('update', annotation.id, comment)" />
    <div v-if="styleOpen" class="style-panel">
      <label>文字 <input v-model="style.color" type="color" /><input v-model="style.color" class="color-value" /></label>
      <label>背景 <input v-model="style.backgroundColor" type="color" /><input v-model="style.backgroundColor" class="color-value" /></label>
      <label>Opacity <input v-model.number="style.opacity" type="number" min="0" max="1" step="0.05" /></label>
      <label>字体 <select v-model="style.fontFamily"><option>Arial</option><option>Helvetica</option><option>Georgia</option><option>monospace</option></select></label>
      <button class="style-confirm" type="button" @click="saveStyle">确认</button>
    </div>
  </article>
</template>

<style scoped>
.annotation { padding: 8px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-root); }.annotation.stale { border-color: var(--warning-border); }.annotation header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11px; }.annotation header span { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; }.annotation header button { border: 0; background: none; color: var(--text-muted); cursor: pointer; }.annotation textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 6px 7px; border: 1px solid var(--border-subtle); border-radius: 6px; outline: 0; background: var(--surface-code); color: var(--text-primary); font: 11px var(--font-sans); }.annotation textarea:focus { border-color: var(--accent); }.style-panel { display: grid; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }.style-panel label { display: grid; grid-template-columns: 54px 30px 1fr; align-items: center; gap: 6px; color: var(--text-muted); font-size: 10px; }.style-panel input, .style-panel select { min-width: 0; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--border-subtle); border-radius: 5px; background: var(--surface-code); color: var(--text-primary); font: 10px var(--font-sans); }.style-panel input[type='color'] { width: 26px; height: 22px; padding: 1px; }.style-confirm { justify-self: end; padding: 4px 9px; border: 0; border-radius: 5px; background: var(--accent); color: var(--text-on-accent); cursor: pointer; font-size: 10px; }
</style>
