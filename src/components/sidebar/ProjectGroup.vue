<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Folder, Plus, Trash2 } from 'lucide-vue-next'
import type { ProjectDto, TaskDto } from '../../domain/models'
import TaskRow from './TaskRow.vue'

const props = defineProps<{ project: ProjectDto; tasks: TaskDto[]; selectedProjectId: string | null; selectedTaskId: string | null }>()
const emit = defineEmits<{ selectProject: []; selectTask: [id: string]; createTask: []; removeProject: []; removeTask: [id: string] }>()
const expanded = ref(true)
const selected = computed(() => props.selectedProjectId === props.project.id)
</script>

<template>
  <section class="project-group">
    <div class="project-row" :class="{ selected }">
      <button class="project-select" type="button" @click="emit('selectProject'); expanded = true">
        <ChevronDown :size="14" :class="{ collapsed: !expanded }" @click.stop="expanded = !expanded" />
        <Folder :size="15" /><span>{{ project.name }}</span>
      </button>
      <button class="mini" type="button" title="新建任务" @click="emit('createTask')"><Plus :size="14" /></button>
      <button class="mini danger" type="button" title="移除项目" @click="emit('removeProject')"><Trash2 :size="13" /></button>
    </div>
    <div v-if="expanded" class="tasks">
      <TaskRow v-for="task in tasks" :key="task.id" :task="task" :selected="selectedTaskId === task.id" @select="emit('selectTask', task.id)" @remove="emit('removeTask', task.id)" />
      <button v-if="!tasks.length" class="first-task" type="button" @click="emit('createTask')">+ 新任务</button>
    </div>
  </section>
</template>

<style scoped>
.project-group { margin-bottom: 4px; }.project-row { display: flex; align-items: center; border-radius: var(--radius-sm); }.project-row:hover { background: rgba(255,255,255,.025); }
.project-select { display: flex; min-width: 0; flex: 1; align-items: center; gap: 7px; padding: 8px; border: 0; background: none; cursor: pointer; text-align: left; }
.project-select span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 580; }.collapsed { transform: rotate(-90deg); }
.mini { display: grid; visibility: hidden; place-items: center; padding: 5px; border: 0; background: none; color: var(--text-secondary); cursor: pointer; }.project-row:hover .mini { visibility: visible; }.mini:hover { color: var(--text-primary); }.mini.danger:hover { color: var(--danger); }
.first-task { margin: 3px 0 5px 26px; border: 0; background: none; color: var(--text-muted); cursor: pointer; font-size: 12px; }.first-task:hover { color: var(--accent); }
</style>
