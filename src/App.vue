<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Files, Globe, RefreshCw } from 'lucide-vue-next'
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
import { isBrowserShortcut } from './services/browserShortcut'
import { formatBrowserCommentDraft, normalizeBrowserUrl, type BrowserCommentPayload } from './services/browserUrl'
import AppSidebar from './components/sidebar/AppSidebar.vue'
import ConversationView from './components/conversation/ConversationView.vue'
import SettingsView from './components/diagnostics/SettingsView.vue'
import EmptyState from './components/common/EmptyState.vue'
import InlineError from './components/common/InlineError.vue'
import StatusPill from './components/common/StatusPill.vue'
import FileBrowserDrawer from './components/files/FileBrowserDrawer.vue'
import BrowserPanel from './components/browser/BrowserPanel.vue'

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
const conversationView = ref<InstanceType<typeof ConversationView> | null>(null)
const browserOpen = ref(false)
const browserLoaded = ref(false)
const browserLoading = ref(false)
let browserLoadTimer: number | undefined
let unlistenBrowserPage: UnlistenFn | undefined
const browserUrl = ref('')
const browserWidth = ref(Math.min(960, Math.max(420, Number(localStorage.getItem('claude-desk:browser-width')) || 680)))
const browserAnnotationEnabled = ref(false)
const sidebarCollapsed = ref(localStorage.getItem('claude-desk:sidebar-collapsed') === 'true')
const browserPanel = ref<InstanceType<typeof BrowserPanel> | null>(null)
const browserError = ref('')
let unlisten: UnlistenFn | undefined
let unlistenBrowserComment: UnlistenFn | undefined
let settingsPoll: number | undefined
let systemThemeQuery: MediaQueryList | undefined

const taskEvents = computed(() => runtime.events(projects.selectedTaskId))
const queuedTurns = computed(() => runtime.queuedTurns(projects.selectedTaskId))
const sidebarStyle = computed(() => ({ '--sidebar-width': `${sidebarCollapsed.value ? 56 : projects.settings.sidebarWidth}px` }))

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('claude-desk:sidebar-collapsed', String(sidebarCollapsed.value))
}

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
  window.addEventListener('keydown', handleBrowserShortcut)
  window.addEventListener('resize', syncBrowserBounds)
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
    unlistenBrowserPage = await listen<{ url: string; loading: boolean }>('browser-page-state', ({ payload }) => {
      console.log('[Browser] browser-page-state', payload)
      browserUrl.value = payload.url
      browserAnnotationEnabled.value = false
      browserError.value = ''
      setBrowserLoading(payload.loading)
      syncBrowserBounds()
    })
    unlistenBrowserComment = await listen<BrowserCommentPayload>('browser-comment', async ({ payload }) => {
      if (!projects.selectedTask) { error.value = t('selectSessionForBrowserComment'); return }
      await conversationView.value?.insertDraft(formatBrowserCommentDraft(payload))
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
  window.removeEventListener('keydown', handleBrowserShortcut)
  window.removeEventListener('resize', syncBrowserBounds)
  unlisten?.()
  unlistenBrowserComment?.()
  unlistenBrowserPage?.()
  window.clearTimeout(browserLoadTimer)
  if (settingsPoll) window.clearInterval(settingsPoll)
  systemThemeQuery?.removeEventListener('change', handleSystemThemeChange)
  void ipc.closeBrowserPanel()
})

async function handleFilesShortcut(event: KeyboardEvent) {
  const blocked = settingsOpen.value || !!document.querySelector('[role="dialog"]') || !projects.selectedProject
  if (!isFilesShortcut(event, blocked)) return
  event.preventDefault()
  filesOpen.value = true
  await nextTick()
  await filesDrawer.value?.focusFilter()
}

function handleBrowserShortcut(event: KeyboardEvent) {
  const blocked = settingsOpen.value || !!document.querySelector('[role="dialog"]')
  if (!isBrowserShortcut(event, blocked)) return
  event.preventDefault()
  openBrowserPanel()
}

async function openBrowserPanel() {
  filesOpen.value = false
  browserError.value = ''
  browserOpen.value = true
  await nextTick()
  await browserPanel.value?.focusAddress()
  console.log('[Browser] openBrowserPanel', { browserOpen: browserOpen.value, browserLoaded: browserLoaded.value, browserWidth: browserWidth.value })
  syncBrowserBounds()
}

async function navigateBrowser(value: string) {
  browserError.value = ''
  try {
    browserUrl.value = normalizeBrowserUrl(value)
    const bounds = browserPanel.value?.webviewBounds()
    console.log('[Browser] navigateBrowser bounds', bounds)
    if (!bounds) throw new Error(t('browserPanelUnavailable'))
    setBrowserLoading(true)
    await ipc.openBrowserPanel(browserUrl.value, { ...bounds, visible: browserOpen.value })
    browserLoaded.value = true
    console.log('[Browser] navigateBrowser success, loaded=true')
    syncBrowserBounds()
  } catch (cause) { console.error('[Browser] navigateBrowser error', cause); setBrowserLoading(false); browserError.value = errorMessage(cause); syncBrowserBounds() }
}

function resizeBrowser(width: number) {
  browserWidth.value = width
  localStorage.setItem('claude-desk:browser-width', String(width))
  syncBrowserBounds()
}

let syncingBrowser = false
let browserBoundsPending = false
async function syncBrowserBounds() {
  browserBoundsPending = true
  if (syncingBrowser) return
  syncingBrowser = true
  try {
    while (browserBoundsPending) {
      browserBoundsPending = false
      await nextTick()
      const bounds = browserPanel.value?.webviewBounds()
      const visible = browserLoaded.value && !browserError.value
      console.log('[Browser] syncBrowserBounds', { browserOpen: browserOpen.value, browserLoaded: browserLoaded.value, browserError: browserError.value, visible, bounds })
      if (browserOpen.value && bounds) {
        await ipc.setBrowserPanelBounds({ ...bounds, visible })
      } else {
        console.log('[Browser] syncBrowserBounds calling closeBrowserPanel')
        await ipc.closeBrowserPanel()
      }
    }
  } catch (cause) { console.error('[Browser] syncBrowserBounds error', cause); browserError.value = errorMessage(cause) }
  finally { syncingBrowser = false }
}

watch([sidebarCollapsed, () => projects.settings.sidebarWidth, filesOpen, settingsOpen, browserWidth, () => projects.selectedTaskId], syncBrowserBounds, { flush: 'post' })

function closeBrowserPanel() {
  browserOpen.value = false
  browserAnnotationEnabled.value = false
  void syncBrowserBounds()
}

function setBrowserLoading(loading: boolean) {
  window.clearTimeout(browserLoadTimer)
  browserLoading.value = loading
  console.log('[Browser] setBrowserLoading', loading)
  if (loading) browserLoadTimer = window.setTimeout(() => {
    browserLoading.value = false
    browserError.value = '网页加载超时，请检查网址或网络后重试。'
    console.log('[Browser] load timeout')
    void syncBrowserBounds()
  }, 30000)
}

async function refreshBrowser() {
  if (!browserLoaded.value) return
  browserError.value = ''
  setBrowserLoading(true)
  try { await ipc.refreshBrowserPanel(); await syncBrowserBounds() }
  catch (cause) { setBrowserLoading(false); browserError.value = errorMessage(cause) }
}

async function browserHistory(direction: 'back' | 'forward') {
  try { await ipc.browserHistory(direction) }
  catch (cause) { browserError.value = errorMessage(cause) }
}

async function setBrowserAnnotation(enabled: boolean) {
  browserError.value = ''
  try {
    await ipc.setBrowserAnnotationMode(enabled)
    browserAnnotationEnabled.value = enabled
  } catch (cause) {
    browserAnnotationEnabled.value = false
    browserError.value = errorMessage(cause)
  }
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

async function addFileSelection(path: string, startLine: number, endLine: number, content: string) {
  await conversationView.value?.insertDraft(`请查看 \`${path}\` 的 R${startLine}-R${endLine}：\n\n\`\`\`\n${content}\n\`\`\``)
}

async function addFileComment(path: string, startLine: number, endLine: number, content: string, comment: string) {
  await conversationView.value?.insertDraft(`请处理 \`${path}\` 的 R${startLine}-R${endLine} 评论：${comment}\n\n\`\`\`\n${content}\n\`\`\``)
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
      :collapsed="sidebarCollapsed"
      @add-project="addProject"
      @select-project="projects.selectProject"
      @select-task="projects.selectTask"
      @create-task="createTask"
      @open-project="openProject"
      @remove-project="removeProject"
      @rename-task="renameTask"
      @remove-task="removeTask"
      @settings="openSettings"
      @toggle-collapse="toggleSidebar"
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
          <button data-testid="browser-button" class="files-button" :class="{ active: browserOpen }" type="button" :aria-pressed="browserOpen" :title="`${t('browser')} (⌘T / Ctrl+T)`" @click="openBrowserPanel"><Globe :size="15" />{{ t('browser') }}</button>
        </header>
        <div class="workspace-body">
          <div class="conversation-pane">
            <div v-if="projects.cli.status !== 'ready'" class="cli-banner"><span>{{ projects.cli.message }}</span><button type="button" @click="projects.refreshDiagnostic"><RefreshCw :size="14" />{{ t('redetect') }}</button><button type="button" @click="openSettings">{{ t('openSettings') }}</button></div>
            <ConversationView ref="conversationView" :task="projects.selectedTask" :events="taskEvents" :queued-turns="queuedTurns" :cli-ready="projects.cli.status === 'ready'" :submit="submit" :adjust="adjustQueued" :send-now="sendQueuedNow" :remove="deleteQueued" :update="updateQueued" @stop="stop" @open-settings="openSettings" @task-updated="projects.patchTask" />
          </div>
          <FileBrowserDrawer
            v-if="filesOpen && projects.selectedProject"
            ref="filesDrawer"
            :project-id="projects.selectedProject.id"
            :project-name="projects.selectedProject.name"
            :width="filesWidth"
            @close="filesOpen = false"
            @resize="resizeFiles"
            @add-to-conversation="addFileSelection"
            @comment="addFileComment"
          />

        </div>
      </template>
      <EmptyState v-else-if="!initialising && !projects.projects.length" :title="t('emptyTitle')" :description="t('emptyDescription')" :action="t('addLocalProject')" @action="addProject" />
      <EmptyState v-else-if="!initialising" :title="t('newTaskTitle')" :description="t('newTaskDescription')" :action="t('newTaskTitle')" @action="projects.selectedProjectId && createTask(projects.selectedProjectId)" />
      <div v-else class="loading-screen"><span>✳</span>{{ t('loadingApp') }}</div>
      <InlineError v-if="error" class="global-error" :message="error" @close="error = ''" />
    </section>
          <BrowserPanel
            v-if="browserOpen"
            ref="browserPanel"
            :width="browserWidth"
            :url="browserUrl"
            :loaded="browserLoaded"
            :loading="browserLoading"
            :annotation-enabled="browserAnnotationEnabled"
            :error="browserError"
            @close="closeBrowserPanel"

            @resize="resizeBrowser"
            @navigate="navigateBrowser"
            @refresh="refreshBrowser"
            @back="browserHistory('back')"
            @forward="browserHistory('forward')"
            @annotation-change="setBrowserAnnotation"
            @bounds-change="syncBrowserBounds"
          />
  </main>
</template>

<style scoped>
.app-shell { display: grid; grid-template-columns: var(--sidebar-width, 280px) minmax(0,1fr) auto; width: 100vw; height: 100vh; background: var(--surface-root); }.workspace { position: relative; display: flex; min-width: 0; min-height: 0; flex-direction: column; }.task-header { display: flex; height: 58px; flex: 0 0 58px; align-items: center; gap: 10px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--border-subtle); background: var(--surface-header); }.task-heading { min-width: 0; }.task-heading h1 { max-width: 300px; overflow: hidden; margin: 0 0 2px; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }.task-path { min-width: 0; flex: 1; overflow: hidden; color: var(--text-muted); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.model-chip { max-width: 210px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.files-button { display: inline-flex; flex: none; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px; }.files-button:hover,.files-button.active { border-color: var(--border-subtle); background: var(--surface-hover); color: var(--text-primary); }.workspace-body { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1; overflow: hidden; }.conversation-pane { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }.cli-banner { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--text-warning); font-size: 12px; }.cli-banner span { flex: 1; }.cli-banner button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: inherit; cursor: pointer; text-decoration: underline; }.loading-screen,.settings-loading { display: flex; flex: 1; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }.loading-screen span { color: var(--accent); font-size: 25px; }.global-error { position: absolute; z-index: 30; right: 16px; bottom: 14px; width: min(520px, calc(100% - 32px)); box-shadow: var(--shadow-lg); }.browser-dialog-backdrop { position: absolute; z-index: 40; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, #000 28%, transparent); }.browser-dialog { width: min(440px, calc(100% - 32px)); padding: 16px; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--surface-root); box-shadow: var(--shadow-lg); }.browser-dialog label { display: block; margin-bottom: 10px; color: var(--text-primary); font-size: 13px; font-weight: 650; }.browser-dialog input { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--border-strong); border-radius: 7px; outline: 0; background: var(--surface-code); color: var(--text-primary); }.browser-dialog input:focus { border-color: var(--accent); }.browser-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 13px; }.browser-dialog button { padding: 7px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); cursor: pointer; }.browser-dialog button[type="submit"] { background: var(--accent); color: var(--text-on-accent); }.browser-error { margin: 8px 0 0; color: var(--danger); font-size: 11px; }
@media (max-width: 800px) { .app-shell { --sidebar-width: 230px !important; }.task-path { display: none; } }
@media (max-width: 960px) { .workspace-body :deep(.files-drawer) { position: absolute; top: 0; right: 0; bottom: 0; max-width: 100%; } }
</style>
