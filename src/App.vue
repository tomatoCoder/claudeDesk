<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ClaudeSettingsDto, SaveClaudeSettingsInput } from './domain/models'
import { useProjectsStore } from './stores/projects'
import { useRuntimeStore } from './stores/runtime'
import { chooseProjectDirectory, errorMessage, ipc } from './services/ipc'
import { listenToTaskEvents } from './services/taskEvents'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import ConversationView from './components/conversation/ConversationView.vue'
import SettingsView from './components/diagnostics/SettingsView.vue'
import EmptyState from './components/common/EmptyState.vue'
import InlineError from './components/common/InlineError.vue'
import StatusPill from './components/common/StatusPill.vue'

const projects = useProjectsStore()
const runtime = useRuntimeStore()
const initialising = ref(true)
const settingsOpen = ref(false)
const claudeSettings = ref<ClaudeSettingsDto | null>(null)
const settingsDirty = ref(false)
const settingsConflict = ref(false)
const savingSettings = ref(false)
const settingsError = ref('')
const error = ref('')
let unlisten: UnlistenFn | undefined
let settingsPoll: number | undefined

const taskEvents = computed(() => runtime.events(projects.selectedTaskId))
const sidebarStyle = computed(() => ({ '--sidebar-width': `${projects.settings.sidebarWidth}px` }))
onMounted(async () => {
  try {
    unlisten = await listenToTaskEvents((event) => {
      runtime.accept(event)
      if (event.kind === 'status_changed') projects.updateTaskStatus(event.taskId, event.data.status)
    })
    const unlistenExit = await listen<string[]>('app-exit-requested', async () => {
      if (!window.confirm('仍有会话正在运行。确认退出并停止这些会话吗？')) return
      await ipc.confirmAppExit()
    })
    const previousUnlisten = unlisten
    unlisten = () => { previousUnlisten?.(); unlistenExit() }
    await projects.hydrate()
    try { claudeSettings.value = await ipc.loadClaudeSettings() }
    catch (cause) { settingsError.value = errorMessage(cause) }
    if (projects.selectedTaskId) await runtime.load(projects.selectedTaskId)
  } catch (cause) { error.value = errorMessage(cause) }
  finally { initialising.value = false }
  settingsPoll = window.setInterval(pollSettings, 2000)
})

onBeforeUnmount(() => {
  unlisten?.()
  if (settingsPoll) window.clearInterval(settingsPoll)
})

watch(() => projects.selectedTaskId, async (taskId) => {
  if (!taskId) return
  try { await runtime.load(taskId) }
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
  if (!window.confirm('从 Claude Desk 移除此项目？项目源码不会被删除。')) return
  try { await projects.removeProject(projectId) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function removeTask(taskId: string) {
  const task = projects.tasks.find((item) => item.id === taskId)
  if (!task || !window.confirm(`删除会话“${task.title}”？活动会话不能删除。`)) return
  try {
    await ipc.deleteTask(taskId)
    projects.tasks = projects.tasks.filter((item) => item.id !== taskId)
    if (projects.selectedTaskId === taskId) projects.selectTask(projects.tasks.find((item) => item.projectId === projects.selectedProjectId)?.id ?? null)
  } catch (cause) { error.value = errorMessage(cause) }
}

async function renameTask(taskId: string) {
  const task = projects.tasks.find((item) => item.id === taskId)
  if (!task) return
  const title = window.prompt('输入新的会话标题', task.title)?.trim()
  if (!title || title === task.title) return
  try { await projects.renameTask(taskId, title) }
  catch (cause) { error.value = errorMessage(cause) }
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

async function openSettings() {
  settingsOpen.value = true
  settingsDirty.value = false
  settingsConflict.value = false
  settingsError.value = ''
  await reloadSettings()
}

async function reloadSettings() {
  try {
    claudeSettings.value = await ipc.loadClaudeSettings()
    settingsDirty.value = false
    settingsConflict.value = false
    settingsError.value = ''
  } catch (cause) { settingsError.value = errorMessage(cause) }
}

async function pollSettings() {
  if (!settingsOpen.value || !claudeSettings.value) return
  try {
    const latest = await ipc.loadClaudeSettings()
    if (latest.version === claudeSettings.value.version) return
    if (settingsDirty.value) settingsConflict.value = true
    else claudeSettings.value = latest
  } catch (cause) { settingsError.value = errorMessage(cause) }
}

async function saveClaudeSettings(input: SaveClaudeSettingsInput) {
  savingSettings.value = true
  settingsError.value = ''
  try {
    claudeSettings.value = await ipc.saveClaudeSettings(input.version, input.values)
    settingsDirty.value = false
    settingsConflict.value = false
  } catch (cause) {
    const message = errorMessage(cause)
    settingsError.value = message
    if (message.includes('修改') || message.includes('冲突')) settingsConflict.value = true
  } finally { savingSettings.value = false }
}
</script>

<template>
  <main class="app-shell" data-testid="app-shell" :style="sidebarStyle">
    <AppSidebar
      :projects="projects.projects"
      :tasks="projects.tasks"
      :selected-project-id="projects.selectedProjectId"
      :selected-task-id="projects.selectedTaskId"
      :cli="projects.cli"
      @add-project="addProject"
      @select-project="projects.selectProject"
      @select-task="projects.selectTask"
      @create-task="createTask"
      @remove-project="removeProject"
      @rename-task="renameTask"
      @remove-task="removeTask"
      @settings="openSettings"
    />
    <section class="workspace">
      <SettingsView
        v-if="settingsOpen && claudeSettings"
        :settings="claudeSettings"
        :cli="projects.cli"
        :saving="savingSettings"
        :external-conflict="settingsConflict"
        :error="settingsError"
        @dirty="settingsDirty = true"
        @save="saveClaudeSettings"
        @reload="reloadSettings"
        @refresh="projects.refreshDiagnostic"
        @close="settingsOpen = false"
      />
      <section v-else-if="settingsOpen" class="settings-loading">
        <InlineError v-if="settingsError" :message="settingsError" @close="settingsOpen = false" />
        <span v-else>正在读取 settings.json…</span>
      </section>
      <template v-else-if="projects.selectedTask">
        <header class="task-header">
          <div class="task-heading"><h1>{{ projects.selectedTask.title }}</h1><StatusPill :status="projects.selectedTask.status" /></div>
          <div class="task-path" :title="projects.selectedProject?.path">{{ projects.selectedProject?.path }}</div>
          <div v-if="claudeSettings?.values.model" class="model-chip" title="新会话默认模型">{{ claudeSettings.values.model }}</div>
        </header>
        <div v-if="projects.cli.status !== 'ready'" class="cli-banner"><span>{{ projects.cli.message }}</span><button type="button" @click="projects.refreshDiagnostic"><RefreshCw :size="14" />重新检测</button><button type="button" @click="openSettings">打开设置</button></div>
        <ConversationView :task="projects.selectedTask" :events="taskEvents" :cli-ready="projects.cli.status === 'ready'" @send="send" @stop="stop" />
      </template>
      <EmptyState v-else-if="!initialising && !projects.projects.length" title="把 Claude Code 放进桌面" description="添加一个本地项目，开始创建或继续 Claude 会话。" action="添加本地项目" @action="addProject" />
      <EmptyState v-else-if="!initialising" title="新建会话" description="会话会写入 Claude 原生历史记录，并可以从左侧继续。" action="新建会话" @action="projects.selectedProjectId && createTask(projects.selectedProjectId)" />
      <div v-else class="loading-screen"><span>✳</span>正在载入 Claude Desk…</div>
      <InlineError v-if="error" class="global-error" :message="error" @close="error = ''" />
    </section>
  </main>
</template>

<style scoped>
.app-shell { display: grid; grid-template-columns: var(--sidebar-width, 280px) minmax(0,1fr); width: 100vw; height: 100vh; background: var(--surface-root); }.workspace { position: relative; display: flex; min-width: 0; min-height: 0; flex-direction: column; }.task-header { display: flex; height: 58px; flex: 0 0 58px; align-items: center; gap: 10px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--border-subtle); background: rgba(11,11,10,.93); }.task-heading { min-width: 0; }.task-heading h1 { max-width: 300px; overflow: hidden; margin: 0 0 2px; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }.task-path { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.model-chip { max-width: 210px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.cli-banner { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid rgba(214,158,46,.25); background: rgba(214,158,46,.07); color: #e2bf72; font-size: 12px; }.cli-banner span { flex: 1; }.cli-banner button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: inherit; cursor: pointer; text-decoration: underline; }.loading-screen,.settings-loading { display: flex; flex: 1; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }.loading-screen span { color: var(--accent); font-size: 25px; }.global-error { position: absolute; z-index: 30; right: 16px; bottom: 14px; width: min(520px, calc(100% - 32px)); box-shadow: var(--shadow-lg); }
@media (max-width: 800px) { .app-shell { --sidebar-width: 230px !important; }.task-path { display: none; } }
</style>
