<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ patch: string }>()
const lines = computed(() => props.patch.split('\n'))
function kind(line: string) { if (line.startsWith('+') && !line.startsWith('+++')) return 'add'; if (line.startsWith('-') && !line.startsWith('---')) return 'del'; if (line.startsWith('@@')) return 'hunk'; return '' }
</script>

<template><pre class="patch"><code v-for="(line,index) in lines" :key="index" :class="kind(line)">{{ line }}
</code></pre></template>

<style scoped>
.patch { min-height: 0; flex: 1; overflow: auto; margin: 0; padding: 10px 0 40px; background: #090908; color: #b9b2a8; font: 10px/1.55 var(--font-mono); }.patch code { display: block; padding: 0 10px; white-space: pre-wrap; word-break: break-all; }.patch .add { background: rgba(80,150,95,.11); color: #9bcba5; }.patch .del { background: rgba(190,70,70,.11); color: #dda0a0; }.patch .hunk { color: #94aad2; }
</style>
