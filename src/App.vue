<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GitCompareArrows, ListTree, RefreshCw } from 'lucide-vue-next'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { AppSettingsDto, WorkspaceDiff } from './domain/models'
import { useProjectsStore } from './stores/projects'
import { useRuntimeStore } from './stores/runtime'
import { chooseProjectDirectory, errorMessage, ipc } from './services/ipc'
import { listenToTaskEvents } from './services/taskEvents'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import ConversationView from './components/conversation/ConversationView.vue'
import DiffPanel from './components/diff/DiffPanel.vue'
import SettingsView from './components/diagnostics/SettingsView.vue'
import RawLogDrawer from './components/diagnostics/RawLogDrawer.vue'
import EmptyState from './components/common/EmptyState.vue'
import InlineError from './components/common/InlineError.vue'
import StatusPill from './components/common/StatusPill.vue'

const projects = useProjectsStore()
const runtime = useRuntimeStore()
const initialising = ref(true)
const settingsOpen = ref(false)
const diffOpen = ref(false)
const diff = ref<WorkspaceDiff | null>(null)
const diffLoading = ref(false)
const logOpen = ref(false)
const rawLog = ref('')
const logLoading = ref(false)
const savingSettings = ref(false)
const error = ref('')
let unlisten: UnlistenFn | undefined

const taskEvents = computed(() => runtime.events(projects.selectedTaskId))
const sidebarStyle = computed(() => ({ '--sidebar-width': `${projects.settings.sidebarWidth}px` }))

onMounted(async () => {
  try {
    unlisten = await listenToTaskEvents((event) => {
      runtime.accept(event)
      if (event.kind === 'status_changed') projects.updateTaskStatus(event.taskId, event.data.status)
    })
    await projects.hydrate()
    if (projects.selectedTaskId) await runtime.load(projects.selectedTaskId)
  } catch (cause) { error.value = errorMessage(cause) }
  finally { initialising.value = false }
})

onBeforeUnmount(() => unlisten?.())

watch(() => projects.selectedTaskId, async (taskId) => {
  diff.value = null
  logOpen.value = false
  if (!taskId) return
  try { await runtime.load(taskId); if (diffOpen.value) await refreshDiff() }
  catch (cause) { error.value = errorMessage(cause) }
})

async function addProject() {
  try { const path = await chooseProjectDirectory(); if (path) await projects.addProject(path) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function createTask(projectId: string) {
  try { await projects.createTask(projectId) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function removeProject(projectId: string) {
  if (!window.confirm('从 Claude Desk 移除此项目及其本地任务记录？项目文件不会被删除。')) return
  try { await projects.removeProject(projectId) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function removeTask(taskId: string) {
  if (!window.confirm('删除此任务及其会话记录索引？Claude 原始会话仍由 CLI 管理。')) return
  try {
    await ipc.deleteTask(taskId)
    projects.tasks = projects.tasks.filter((task) => task.id !== taskId)
    if (projects.selectedTaskId === taskId) projects.selectTask(projects.tasks.find((task) => task.projectId === projects.selectedProjectId)?.id ?? null)
  } catch (cause) { error.value = errorMessage(cause) }
}

async function send(text: string) {
  if (!projects.selectedTask) return
  try { await ipc.sendTurn(projects.selectedTask.id, text) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function stop() {
  if (!projects.selectedTask) return
  try { await ipc.cancelTask(projects.selectedTask.id) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function refreshDiff() {
  if (!projects.selectedProject) return
  diffLoading.value = true
  try { diff.value = await ipc.workspaceDiff(projects.selectedProject.id) }
  catch (cause) { error.value = errorMessage(cause) }
  finally { diffLoading.value = false }
}

async function toggleDiff() { diffOpen.value = !diffOpen.value; if (diffOpen.value) await refreshDiff() }

async function refreshLog() {
  if (!projects.selectedTask) return
  logLoading.value = true
  try { rawLog.value = await ipc.rawLog(projects.selectedTask.id) }
  catch (cause) { error.value = errorMessage(cause) }
  finally { logLoading.value = false }
}

async function toggleLog() { logOpen.value = !logOpen.value; if (logOpen.value) await refreshLog() }

async function saveSettings(value: AppSettingsDto) {
  savingSettings.value = true
  try { await projects.persistSettings(value); settingsOpen.value = false }
  catch (cause) { error.value = errorMessage(cause) }
  finally { savingSettings.value = false }
}
</script>

<template>
  <main class="app-shell" data-testid="app-shell" :style="sidebarStyle">
    <AppSidebar :projects="projects.projects" :tasks="projects.tasks" :selected-project-id="projects.selectedProjectId" :selected-task-id="projects.selectedTaskId" :cli="projects.cli" @add-project="addProject" @select-project="projects.selectProject" @select-task="projects.selectTask" @create-task="createTask" @remove-project="removeProject" @remove-task="removeTask" @settings="settingsOpen = true" />
    <section class="workspace">
      <SettingsView v-if="settingsOpen" :settings="projects.settings" :cli="projects.cli" :saving="savingSettings" @save="saveSettings" @refresh="projects.refreshDiagnostic" @close="settingsOpen = false" />
      <template v-else-if="projects.selectedTask">
        <header class="task-header"><div class="task-heading"><h1>{{ projects.selectedTask.title }}</h1><StatusPill :status="projects.selectedTask.status" /></div><div class="task-path" :title="projects.selectedProject?.path">{{ projects.selectedProject?.path }}</div><button class="header-action" type="button" :class="{ active: logOpen }" @click="toggleLog"><ListTree :size="15" />日志</button><button class="header-action" type="button" :class="{ active: diffOpen }" @click="toggleDiff"><GitCompareArrows :size="15" />Diff</button></header>
        <div v-if="projects.cli.status !== 'ready'" class="cli-banner"><span>{{ projects.cli.message }}</span><button type="button" @click="projects.refreshDiagnostic"><RefreshCw :size="14" />重新检查</button><button type="button" @click="settingsOpen = true">打开设置</button></div>
        <div class="task-content"><ConversationView :task="projects.selectedTask" :events="taskEvents" :cli-ready="projects.cli.status === 'ready'" @send="send" @stop="stop" /><DiffPanel v-if="diffOpen" :diff="diff" :loading="diffLoading" @refresh="refreshDiff" @close="diffOpen = false" /></div>
        <RawLogDrawer v-if="logOpen" :content="rawLog" :loading="logLoading" @refresh="refreshLog" @close="logOpen = false" />
      </template>
      <EmptyState v-else-if="!initialising && !projects.projects.length" title="把 Claude Code 放进桌面" description="添加一个本地项目，然后就可以在图形界面中启动多个独立任务。" action="添加本地项目" @action="addProject" />
      <EmptyState v-else-if="!initialising" title="创建一个任务" description="任务会保留 Claude 会话 ID，可以随时从左侧继续。" action="新建任务" @action="projects.selectedProjectId && createTask(projects.selectedProjectId)" />
      <div v-else class="loading-screen"><span>✳</span>正在载入 Claude Desk…</div>
      <InlineError v-if="error" class="global-error" :message="error" @close="error = ''" />
    </section>
  </main>
</template>

<style scoped>
.app-shell { display: grid; grid-template-columns: var(--sidebar-width, 280px) minmax(0,1fr); width: 100vw; height: 100vh; background: var(--surface-root); }.workspace { position: relative; display: flex; min-width: 0; min-height: 0; flex-direction: column; }.task-header { display: flex; height: 58px; flex: 0 0 58px; align-items: center; gap: 10px; padding: 0 12px 0 20px; border-bottom: 1px solid var(--border-subtle); background: rgba(11,11,10,.93); }.task-heading { min-width: 0; }.task-heading h1 { max-width: 300px; overflow: hidden; margin: 0 0 2px; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }.task-path { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.header-action { display: inline-flex; align-items: center; gap: 6px; padding: 7px 9px; border: 1px solid transparent; border-radius: var(--radius-sm); background: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; }.header-action:hover,.header-action.active { border-color: var(--border-subtle); background: var(--surface-raised); color: var(--text-primary); }.header-action.active { color: var(--accent); }.task-content { display: flex; min-height: 0; flex: 1; }.cli-banner { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid rgba(214,158,46,.25); background: rgba(214,158,46,.07); color: #e2bf72; font-size: 12px; }.cli-banner span { flex: 1; }.cli-banner button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: inherit; cursor: pointer; text-decoration: underline; }.loading-screen { display: flex; flex: 1; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }.loading-screen span { color: var(--accent); font-size: 25px; }.global-error { position: absolute; z-index: 30; right: 16px; bottom: 14px; width: min(520px, calc(100% - 32px)); box-shadow: var(--shadow-lg); }
@media (max-width: 1050px) { .app-shell { --sidebar-width: 240px !important; }.diff-panel { position: absolute; z-index: 8; inset: 58px 0 0 auto; height: calc(100% - 58px); } }
</style>
