import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettingsDto, CliDiagnosticDto, ProjectDto, TaskDto } from '../domain/models'
import type { TaskStatus } from '../domain/events'
import { ipc } from '../services/ipc'
import { translate } from '../services/i18n'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectDto[]>([])
  const tasks = ref<TaskDto[]>([])
  const settings = ref<AppSettingsDto>({ claudePath: null, sidebarWidth: 280, theme: 'system', language: 'zh-CN', openWith: 'default', permissionMode: 'default' })
  const cli = ref<CliDiagnosticDto>({ status: 'probe_failed', path: null, version: null, message: translate('checkingClaudeCode') })
  const selectedProjectId = ref<string | null>(localStorage.getItem('claude-desk:selected-project'))
  const selectedTaskId = ref<string | null>(localStorage.getItem('claude-desk:selected-task'))

  const selectedProject = computed(() => projects.value.find((project) => project.id === selectedProjectId.value) ?? null)
  const selectedTask = computed(() => tasks.value.find((task) => task.id === selectedTaskId.value) ?? null)

  async function hydrate() {
    let snapshot = await ipc.snapshot()
    if (snapshot.cli.status === 'ready') {
      try { snapshot = await ipc.refreshSessions() } catch { /* 手动项目仍可继续使用 */ }
    }
    projects.value = snapshot.projects
    tasks.value = snapshot.tasks
    settings.value = snapshot.settings
    cli.value = snapshot.cli
    if (!selectedProject.value) selectedProjectId.value = projects.value[0]?.id ?? null
    if (!selectedTask.value || selectedTask.value.projectId !== selectedProjectId.value) {
      selectedTaskId.value = tasks.value.find((task) => task.projectId === selectedProjectId.value)?.id ?? null
    }
  }

  function selectProject(id: string) {
    selectedProjectId.value = id
    localStorage.setItem('claude-desk:selected-project', id)
    const first = tasks.value.find((task) => task.projectId === id)
    selectTask(first?.id ?? null)
  }

  function selectTask(id: string | null) {
    selectedTaskId.value = id
    if (id) {
      localStorage.setItem('claude-desk:selected-task', id)
      const task = tasks.value.find((item) => item.id === id)
      if (task) selectedProjectId.value = task.projectId
    } else localStorage.removeItem('claude-desk:selected-task')
  }

  async function addProject(path: string) {
    const project = await ipc.addProject(path)
    const existing = projects.value.findIndex((item) => item.id === project.id)
    if (existing >= 0) projects.value.splice(existing, 1, project)
    else projects.value.unshift(project)
    selectProject(project.id)
    if (!tasks.value.some((task) => task.projectId === project.id)) await createTask(project.id)
  }

  async function createTask(projectId: string) {
    const task = await ipc.createTask(projectId)
    tasks.value.unshift(task)
    selectTask(task.id)
    return task
  }

  async function renameTask(taskId: string, title: string) {
    const updated = await ipc.renameTask(taskId, title)
    const index = tasks.value.findIndex((task) => task.id === taskId)
    if (index >= 0) tasks.value.splice(index, 1, updated)
  }

  async function removeProject(projectId: string) {
    await ipc.removeProject(projectId)
    projects.value = projects.value.filter((project) => project.id !== projectId)
    tasks.value = tasks.value.filter((task) => task.projectId !== projectId)
    if (selectedProjectId.value === projectId) selectProject(projects.value[0]?.id ?? '')
  }

  function updateTaskStatus(taskId: string, status: TaskStatus) {
    const task = tasks.value.find((item) => item.id === taskId)
    if (task) { task.status = status; task.updatedAt = new Date().toISOString() }
  }

  async function refreshDiagnostic() { cli.value = await ipc.diagnoseClaude() }

  async function persistSettings(value: AppSettingsDto) {
    const previousClaudePath = settings.value.claudePath
    settings.value = await ipc.saveSettings(value)
    if (settings.value.claudePath !== previousClaudePath) await refreshDiagnostic()
  }

  return { projects, tasks, settings, cli, selectedProjectId, selectedTaskId, selectedProject, selectedTask, hydrate, selectProject, selectTask, addProject, createTask, renameTask, removeProject, updateTaskStatus, refreshDiagnostic, persistSettings }
})
