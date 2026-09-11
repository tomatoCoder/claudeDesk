<script setup lang="ts">
import { Plus, Settings } from 'lucide-vue-next'
import appLogo from '../../assets/app-logo.png'
import type { CliDiagnosticDto, ProjectDto, TaskDto } from '../../domain/models'
import { useI18n } from '../../services/i18n'
import ProjectGroup from './ProjectGroup.vue'

defineProps<{ projects: ProjectDto[]; tasks: TaskDto[]; selectedProjectId: string | null; selectedTaskId: string | null; cli: CliDiagnosticDto }>()
const emit = defineEmits<{ addProject: []; selectProject: [id: string]; selectTask: [id: string]; createTask: [projectId: string]; openProject: [id: string]; removeProject: [id: string]; renameTask: [id: string]; removeTask: [id: string]; settings: [] }>()
const { t } = useI18n()
</script>

<template>
  <aside class="app-sidebar">
    <header class="brand"><img class="brand-logo" :src="appLogo" alt="" /><span>Claude Desk</span><button class="icon-button add" type="button" :title="t('addProject')" @click="emit('addProject')"><Plus :size="18" /></button></header>
    <nav :aria-label="t('projectNavigation')">
      <ProjectGroup v-for="project in projects" :key="project.id" :project="project" :tasks="tasks.filter((task) => task.projectId === project.id)" :selected-project-id="selectedProjectId" :selected-task-id="selectedTaskId" @select-project="emit('selectProject', project.id)" @select-task="emit('selectTask', $event)" @create-task="emit('createTask', project.id)" @open-project="emit('openProject', project.id)" @remove-project="emit('removeProject', project.id)" @rename-task="emit('renameTask', $event)" @remove-task="emit('removeTask', $event)" />
      <button v-if="!projects.length" class="add-project-empty" type="button" @click="emit('addProject')"><Plus :size="16" /> {{ t('addLocalProject') }}</button>
    </nav>
    <footer>
      <button class="settings-row" type="button" @click="emit('settings')"><Settings :size="16" /><span>{{ t('settings') }}</span><i :class="cli.status" :title="cli.message" /></button>
    </footer>
  </aside>
</template>

<style scoped>
.app-sidebar { display: flex; height: 100vh; min-width: 0; flex-direction: column; border-right: 1px solid var(--border-subtle); background: var(--surface-sidebar); }
.brand { display: flex; align-items: center; gap: 9px; height: 58px; padding: 0 12px 0 13px; font-size: 15px; font-weight: 680; }.brand-logo { width: 30px; height: 30px; flex: 0 0 30px; object-fit: contain; }.brand .add { margin-left: auto; color: var(--text-secondary); }
nav { flex: 1; overflow: auto; padding: 7px 8px; }.add-project-empty { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }.add-project-empty:hover { border-color: var(--accent); color: var(--text-primary); }
footer { padding: 8px; border-top: 1px solid var(--border-subtle); }.settings-row { display: flex; width: 100%; align-items: center; gap: 9px; padding: 9px; border: 0; border-radius: var(--radius-sm); background: none; cursor: pointer; }.settings-row:hover { background: var(--surface-hover); }.settings-row i { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: var(--danger); }.settings-row i.ready { background: var(--success); }.settings-row i.too_old, .settings-row i.not_authenticated { background: var(--warning); }
</style>
