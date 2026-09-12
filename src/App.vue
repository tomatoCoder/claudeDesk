<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Files, RefreshCw } from 'lucide-vue-next'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppLanguage, AppPermissionMode, ClaudeSettingsDto, ProjectOpenWith, SaveClaudeSettingsInput, SaveClaudeSettingsJsonInput, ThemePreference } from './domain/models'
import { useProjectsStore } from './stores/projects'
import { useRuntimeStore } from './stores/runtime'
import { chooseProjectDirectory, errorMessage, ipc } from './services/ipc'
import { listenToTaskEvents } from './services/taskEvents'
import { listenToQueuedTurns } from './services/queuedTurns'
import { applyTheme } from './services/theme'
import { setAppLanguage, useI18n } from './services/i18n'
import { isFilesShortcut } from './services/fileShortcut'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import ConversationView from './components/conversation/ConversationView.vue'
import SettingsView from './components/diagnostics/SettingsView.vue'
import EmptyState from './components/common/EmptyState.vue'
import InlineError from './components/common/InlineError.vue'
import StatusPill from './components/common/StatusPill.vue'
import FileBrowserDrawer from './components/files/FileBrowserDrawer.vue'

const projects = useProjectsStore()
const runtime = useRuntimeStore()
const { t } = useI18n()
const initialising = ref(true)
const settingsOpen = ref(false)
const claudeSettings = ref<ClaudeSettingsDto | null>(null)
const settingsDirty = ref(false)
const settingsConflict = ref(false)
const savingSettings = ref(false)
const settingsError = ref('')
const error = ref('')
const filesOpen = ref(false)
const filesWidth = ref(Math.min(960, Math.max(520, Number(localStorage.getItem('claude-desk:files-width')) || 680)))
const filesDrawer = ref<InstanceType<typeof FileBrowserDrawer> | null>(null)
let unlisten: UnlistenFn | undefined
let settingsPoll: number | undefined
let systemThemeQuery: MediaQueryList | undefined

const taskEvents = computed(() => runtime.events(projects.selectedTaskId))
const queuedTurns = computed(() => runtime.queuedTurns(projects.selectedTaskId))
const sidebarStyle = computed(() => ({ '--sidebar-width': `${projects.settings.sidebarWidth}px` }))

function getSystemThemeQuery() {
  return systemThemeQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
}

function syncTheme(theme = projects.settings.theme) {
  applyTheme(theme, getSystemThemeQuery().matches)
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  if (projects.settings.theme === 'system') applyTheme('system', event.matches)
}

watch(() => projects.settings.theme, (theme) => syncTheme(theme), { immediate: true })
watch(() => projects.settings.language, setAppLanguage, { immediate: true })

onMounted(async () => {
  window.addEventListener('keydown', handleFilesShortcut)
  getSystemThemeQuery().addEventListener('change', handleSystemThemeChange)
  try {
    const unlistenTasks = await listenToTaskEvents((event) => {
      runtime.accept(event)
      if (event.kind === 'status_changed') projects.updateTaskStatus(event.taskId, event.data.status)
    })
    const unlistenQueued = await listenToQueuedTurns(runtime.replaceQueuedTurns)
    const unlistenExit = await listen<string[]>('app-exit-requested', async () => {
      if (!window.confirm(t('exitConfirm'))) return
      await ipc.confirmAppExit()
    })
    unlisten = () => { unlistenTasks(); unlistenQueued(); unlistenExit() }
    await projects.hydrate()
    try { claudeSettings.value = await ipc.loadClaudeSettings() }
    catch (cause) { settingsError.value = errorMessage(cause) }
    if (projects.selectedTaskId) await Promise.all([runtime.load(projects.selectedTaskId), runtime.loadQueuedTurns(projects.selectedTaskId)])
  } catch (cause) { error.value = errorMessage(cause) }
  finally { initialising.value = false }
  settingsPoll = window.setInterval(pollSettings, 2000)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleFilesShortcut)
  unlisten?.()
  if (settingsPoll) window.clearInterval(settingsPoll)
  systemThemeQuery?.removeEventListener('change', handleSystemThemeChange)
})

async function handleFilesShortcut(event: KeyboardEvent) {
  const blocked = settingsOpen.value || !!document.querySelector('[role="dialog"]') || !projects.selectedProject
  if (!isFilesShortcut(event, blocked)) return
  event.preventDefault()
  filesOpen.value = true
  await nextTick()
  await filesDrawer.value?.focusFilter()
}

async function toggleFiles() {
  filesOpen.value = !filesOpen.value
  if (filesOpen.value) {
    await nextTick()
    await filesDrawer.value?.focusFilter()
  }
}

function resizeFiles(width: number) {
  filesWidth.value = width
  localStorage.setItem('claude-desk:files-width', String(width))
}

watch(() => projects.selectedTaskId, async (taskId) => {
  if (!taskId) return
  try { await Promise.all([runtime.load(taskId), runtime.loadQueuedTurns(taskId)]) }
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
  if (!window.confirm(t('removeProjectConfirm'))) return
  try { await projects.removeProject(projectId) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function openProject(projectId: string) {
  try { await ipc.openProject(projectId) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function removeTask(taskId: string) {
  const task = projects.tasks.find((item) => item.id === taskId)
  if (!task || !window.confirm(t('deleteTaskConfirm', { title: task.title }))) return
  try {
    await ipc.deleteTask(taskId)
    projects.tasks = projects.tasks.filter((item) => item.id !== taskId)
    if (projects.selectedTaskId === taskId) projects.selectTask(projects.tasks.find((item) => item.projectId === projects.selectedProjectId)?.id ?? null)
  } catch (cause) { error.value = errorMessage(cause) }
}

async function renameTask(taskId: string, title: string) {
  try { await projects.renameTask(taskId, title) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function submit(text: string) {
  if (!projects.selectedTask) throw new Error('未选择任务')
  try { await ipc.submitTurn(projects.selectedTask.id, text) }
  catch (cause) { error.value = errorMessage(cause); throw cause }
}

async function updateQueued(id: string, text: string) {
  if (!projects.selectedTask) throw new Error('未选择任务')
  try { await ipc.updateQueuedTurn(projects.selectedTask.id, id, text) }
  catch (cause) { error.value = errorMessage(cause); throw cause }
}

async function deleteQueued(id: string) {
  if (!projects.selectedTask) throw new Error('未选择任务')
  try { await ipc.deleteQueuedTurn(projects.selectedTask.id, id) }
  catch (cause) { error.value = errorMessage(cause); throw cause }
}

async function adjustQueued(id: string) {
  if (!projects.selectedTask) throw new Error('未选择任务')
  try { await ipc.adjustQueuedTurn(projects.selectedTask.id, id) }
  catch (cause) { error.value = errorMessage(cause); throw cause }
}

async function sendQueuedNow(id: string) {
  if (!projects.selectedTask) throw new Error('未选择任务')
  try { await ipc.sendQueuedTurn(projects.selectedTask.id, id) }
  catch (cause) { error.value = errorMessage(cause); throw cause }
}

async function stop() {
  if (!projects.selectedTask) return
  try { await ipc.cancelTask(projects.selectedTask.id) }
  catch (cause) { error.value = errorMessage(cause) }
}

async function openSettings() {
  filesOpen.value = false
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
    settingsOpen.value = false
  } catch (cause) {
    const message = errorMessage(cause)
    settingsError.value = message
    if (message.includes('修改') || message.includes('冲突')) settingsConflict.value = true
  } finally { savingSettings.value = false }
}

async function saveClaudeSettingsJson(input: SaveClaudeSettingsJsonInput) {
  savingSettings.value = true
  settingsError.value = ''
  try {
    claudeSettings.value = await ipc.saveClaudeSettingsJson(input.version, input.raw)
    settingsDirty.value = false
    settingsConflict.value = false
    settingsOpen.value = false
  } catch (cause) {
    const message = errorMessage(cause)
    settingsError.value = message
    if (message.includes('修改') || message.includes('冲突')) settingsConflict.value = true
  } finally { savingSettings.value = false }
}

async function changeTheme(theme: ThemePreference) {
  if (theme === projects.settings.theme) return
  const previousTheme = projects.settings.theme
  projects.settings.theme = theme
  settingsError.value = ''
  try {
    await projects.persistSettings({ ...projects.settings, theme })
  } catch (cause) {
    projects.settings.theme = previousTheme
    settingsError.value = errorMessage(cause)
  }
}

async function changeLanguage(language: AppLanguage) {
  if (language === projects.settings.language) return
  const previousLanguage = projects.settings.language
  projects.settings.language = language
  settingsError.value = ''
  try {
    await projects.persistSettings({ ...projects.settings, language })
  } catch (cause) {
    projects.settings.language = previousLanguage
    settingsError.value = errorMessage(cause)
  }
}

async function changeOpenWith(openWith: ProjectOpenWith) {
  if (openWith === projects.settings.openWith) return
  const previousOpenWith = projects.settings.openWith
  projects.settings.openWith = openWith
  settingsError.value = ''
  try {
    await projects.persistSettings({ ...projects.settings, openWith })
  } catch (cause) {
    projects.settings.openWith = previousOpenWith
    settingsError.value = errorMessage(cause)
  }
}

async function changePermissionMode(permissionMode: AppPermissionMode) {
  if (permissionMode === projects.settings.permissionMode) return
  const previousPermissionMode = projects.settings.permissionMode
  projects.settings.permissionMode = permissionMode
  settingsError.value = ''
  try {
    await projects.persistSettings({ ...projects.settings, permissionMode })
  } catch (cause) {
    projects.settings.permissionMode = previousPermissionMode
    settingsError.value = errorMessage(cause)
  }
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
      @open-project="openProject"
      @remove-project="removeProject"
      @rename-task="renameTask"
      @remove-task="removeTask"
      @settings="openSettings"
    />
    <section class="workspace">
      <SettingsView
        v-if="settingsOpen && claudeSettings"
        :settings="claudeSettings"
        :theme="projects.settings.theme"
        :language="projects.settings.language"
        :open-with="projects.settings.openWith"
        :permission-mode="projects.settings.permissionMode"
        :cli="projects.cli"
        :saving="savingSettings"
        :external-conflict="settingsConflict"
        :error="settingsError"
        @dirty="settingsDirty = true"
        @theme-change="changeTheme"
        @language-change="changeLanguage"
        @open-with-change="changeOpenWith"
        @permission-mode-change="changePermissionMode"
        @save="saveClaudeSettings"
        @save-json="saveClaudeSettingsJson"
        @reload="reloadSettings"
        @refresh="projects.refreshDiagnostic"
        @close="settingsOpen = false"
      />
      <section v-else-if="settingsOpen" class="settings-loading">
        <InlineError v-if="settingsError" :message="settingsError" @close="settingsOpen = false" />
        <span v-else>{{ t('settingsLoading') }}</span>
      </section>
      <template v-else-if="projects.selectedTask">
        <header class="task-header">
          <div class="task-heading"><h1>{{ projects.selectedTask.title }}</h1><StatusPill :status="projects.selectedTask.status" /></div>
          <div class="task-path" :title="projects.selectedProject?.path">{{ projects.selectedProject?.path }}</div>
          <div v-if="claudeSettings?.values.model" class="model-chip" :title="t('newSessionDefaultModel')">{{ claudeSettings.values.model }}</div>
          <button
            data-testid="files-button"
            class="files-button"
            :class="{ active: filesOpen }"
            type="button"
            :aria-pressed="filesOpen"
            :title="`${t('files')} (⌘P / Ctrl+P)`"
            @click="toggleFiles"
          ><Files :size="15" />{{ t('files') }}</button>
        </header>
        <div class="workspace-body">
          <div class="conversation-pane">
            <div v-if="projects.cli.status !== 'ready'" class="cli-banner"><span>{{ projects.cli.message }}</span><button type="button" @click="projects.refreshDiagnostic"><RefreshCw :size="14" />{{ t('redetect') }}</button><button type="button" @click="openSettings">{{ t('openSettings') }}</button></div>
            <ConversationView :task="projects.selectedTask" :events="taskEvents" :queued-turns="queuedTurns" :cli-ready="projects.cli.status === 'ready'" :submit="submit" :adjust="adjustQueued" :send-now="sendQueuedNow" :remove="deleteQueued" :update="updateQueued" @stop="stop" @open-settings="openSettings" @task-updated="projects.patchTask" />
          </div>
          <FileBrowserDrawer
            v-if="filesOpen && projects.selectedProject"
            ref="filesDrawer"
            :project-id="projects.selectedProject.id"
            :project-name="projects.selectedProject.name"
            :width="filesWidth"
            @close="filesOpen = false"
            @resize="resizeFiles"
          />
        </div>
      </template>
      <EmptyState v-else-if="!initialising && !projects.projects.length" :title="t('emptyTitle')" :description="t('emptyDescription')" :action="t('addLocalProject')" @action="addProject" />
      <EmptyState v-else-if="!initialising" :title="t('newTaskTitle')" :description="t('newTaskDescription')" :action="t('newTaskTitle')" @action="projects.selectedProjectId && createTask(projects.selectedProjectId)" />
      <div v-else class="loading-screen"><span>✳</span>{{ t('loadingApp') }}</div>
      <InlineError v-if="error" class="global-error" :message="error" @close="error = ''" />
    </section>
  </main>
</template>

<style scoped>
.app-shell { display: grid; grid-template-columns: var(--sidebar-width, 280px) minmax(0,1fr); width: 100vw; height: 100vh; background: var(--surface-root); }.workspace { position: relative; display: flex; min-width: 0; min-height: 0; flex-direction: column; }.task-header { display: flex; height: 58px; flex: 0 0 58px; align-items: center; gap: 10px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }.task-heading { min-width: 0; }.task-heading h1 { max-width: 300px; overflow: hidden; margin: 0 0 2px; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }.task-path { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.model-chip { max-width: 210px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.files-button { display: inline-flex; flex: none; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px; }.files-button:hover,.files-button.active { border-color: var(--border-subtle); background: var(--surface-hover); color: var(--text-primary); }.workspace-body { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1; overflow: hidden; }.conversation-pane { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }.cli-banner { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--text-warning); font-size: 12px; }.cli-banner span { flex: 1; }.cli-banner button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: inherit; cursor: pointer; text-decoration: underline; }.loading-screen,.settings-loading { display: flex; flex: 1; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }.loading-screen span { color: var(--accent); font-size: 25px; }.global-error { position: absolute; z-index: 30; right: 16px; bottom: 14px; width: min(520px, calc(100% - 32px)); box-shadow: var(--shadow-lg); }
@media (max-width: 800px) { .app-shell { --sidebar-width: 230px !important; }.task-path { display: none; } }
@media (max-width: 960px) { .workspace-body :deep(.files-drawer) { position: absolute; top: 0; right: 0; bottom: 0; max-width: 100%; } }
</style>
