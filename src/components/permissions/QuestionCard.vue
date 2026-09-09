<script setup lang="ts">
import { reactive } from 'vue'
import type { UserQuestion } from '../../domain/events'

const props = defineProps<{ questions: UserQuestion[] }>()
const emit = defineEmits<{ resolve: [updatedInput: unknown]; deny: [] }>()
const answers = reactive<Record<string, string[]>>({})
const custom = reactive<Record<string, string>>({})

function toggle(question: UserQuestion, label: string) {
  const values = answers[question.question] ?? (answers[question.question] = [])
  if (!question.multiSelect) { answers[question.question] = [label]; return }
  const index = values.indexOf(label)
  if (index >= 0) values.splice(index, 1); else values.push(label)
}

function submit() {
  const resolved: Record<string, string> = {}
  for (const question of props.questions) {
    resolved[question.question] = custom[question.question]?.trim() || (answers[question.question] ?? []).join(', ')
  }
  emit('resolve', { questions: props.questions, answers: resolved })
}
</script>

<template>
  <section class="question-card">
    <div v-for="question in questions" :key="question.question" class="question">
      <span class="header">{{ question.header }}</span><h3>{{ question.question }}</h3>
      <button v-for="option in question.options" :key="option.label" type="button" class="option" :class="{ selected: answers[question.question]?.includes(option.label) }" @click="toggle(question, option.label)"><strong>{{ option.label }}</strong><small>{{ option.description }}</small></button>
      <input v-model="custom[question.question]" type="text" placeholder="或输入其他答案…" />
    </div>
    <footer><button class="danger-button" type="button" @click="emit('deny')">取消</button><button class="primary-button" type="button" @click="submit">提交答案</button></footer>
  </section>
</template>

<style scoped>
.question-card { margin: 14px 40px; padding: 15px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface-raised); }.question + .question { margin-top: 18px; }.header { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }.question h3 { margin: 5px 0 10px; font-size: 14px; }.option { display: flex; width: 100%; flex-direction: column; gap: 3px; margin: 5px 0; padding: 9px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: rgba(0,0,0,.15); cursor: pointer; text-align: left; }.option.selected { border-color: var(--accent); background: var(--accent-soft); }.option small { color: var(--text-secondary); }.question input { width: 100%; margin-top: 6px; padding: 9px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-input); color: var(--text-primary); }.question-card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
