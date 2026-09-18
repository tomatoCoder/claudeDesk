import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { AppSettingsDto, ProjectDto, TaskDto, TaskEvent, TaskPermissionMode, TaskStatus } from '../../shared/contracts.js'
import { AppError } from '../../shared/errors.js'
import { backupDatabase } from './backup.js'
import { CURRENT_SCHEMA_VERSION, migrate, schemaVersion } from './migrations.js'

const DEFAULT_SETTINGS: AppSettingsDto = {
  claudePath: null,
  sidebarWidth: 280,
  theme: 'system',
  language: 'zh-CN',
  openWith: 'default',
  terminalApp: 'default',
  permissionMode: 'default',
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['starting', 'running', 'awaiting_permission', 'stopping'])

export class Storage {
  readonly database: Database.Database

  constructor(readonly databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    const existed = fs.existsSync(databasePath)
    let database = new Database(databasePath)
    const previousVersion = schemaVersion(database)
    if (previousVersion > CURRENT_SCHEMA_VERSION) {
      database.close()
      throw new AppError('database_too_new', '数据由更新版本的 Claude Desk 创建，当前版本无法安全打开', false)
    }
    if (existed && previousVersion < CURRENT_SCHEMA_VERSION) {
      database.close()
      backupDatabase(databasePath)
      database = new Database(databasePath)
    }
    migrate(database)
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (integrity.quick_check !== 'ok') {
      database.close()
      throw new AppError('database_integrity_failed', `数据库完整性检查失败：${integrity.quick_check}`, false)
    }
    this.database = database
  }

  close() { this.database.close() }

  listProjects(): ProjectDto[] {
    return (this.database.prepare('SELECT id,name,canonical_path,created_at,last_opened_at FROM projects ORDER BY last_opened_at DESC').all() as unknown as ProjectRow[]).map(projectFromRow)
  }

  getProject(id: string): ProjectDto {
    const row = this.database.prepare('SELECT id,name,canonical_path,created_at,last_opened_at FROM projects WHERE id=?').get(id) as ProjectRow | undefined
    if (!row) throw new AppError('project_not_found', '项目不存在', true)
    return projectFromRow(row)
  }

  createOrTouchProject(directory: string): ProjectDto {
    let canonical: string
    try { canonical = fs.realpathSync(directory) } catch { throw new AppError('invalid_project_path', '项目目录不存在或不可访问', true) }
    if (!fs.statSync(canonical).isDirectory()) throw new AppError('invalid_project_path', '请选择一个目录', true)
    const name = path.basename(canonical) || 'Project'
    const now = new Date().toISOString()
    const existing = this.database.prepare('SELECT id FROM projects WHERE canonical_path=?').get(canonical) as { id: string } | undefined
    if (existing) {
      this.database.prepare('UPDATE projects SET name=?,last_opened_at=? WHERE id=?').run(name, now, existing.id)
      return this.getProject(existing.id)
    }
    const id = randomUUID()
    this.database.prepare('INSERT INTO projects(id,name,canonical_path,created_at,last_opened_at) VALUES(?,?,?,?,?)').run(id, name, canonical, now, now)
    return this.getProject(id)
  }

  removeProject(id: string) {
    if (this.listProjectTasks(id).some((task) => ACTIVE_STATUSES.has(task.status))) {
      throw new AppError('project_has_active_tasks', '项目仍有正在运行的任务', true)
    }
    this.database.prepare('DELETE FROM projects WHERE id=?').run(id)
  }

  listTasks(): TaskDto[] {
    return (this.database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY updated_at DESC`).all() as unknown as TaskRow[]).map(taskFromRow)
  }

  listProjectTasks(projectId: string): TaskDto[] {
    return (this.database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id=? ORDER BY updated_at DESC`).all(projectId) as unknown as TaskRow[]).map(taskFromRow)
  }

  getTask(id: string): TaskDto {
    const row = this.database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id=?`).get(id) as TaskRow | undefined
    if (!row) throw new AppError('task_not_found', '任务不存在', true)
    return taskFromRow(row)
  }

  createTask(projectId: string, title = '新任务'): TaskDto {
    this.getProject(projectId)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.database.prepare("INSERT INTO tasks(id,project_id,title,status,created_at,updated_at) VALUES(?,?,?,'idle',?,?)").run(id, projectId, title, now, now)
    return this.getTask(id)
  }

  upsertClaudeSession(projectId: string, sessionId: string, title: string, updatedAt: string): TaskDto {
    this.getProject(projectId)
    const name = title.trim() || '未命名会话'
    const existing = this.database.prepare('SELECT id FROM tasks WHERE claude_session_id=? LIMIT 1').get(sessionId) as { id: string } | undefined
    if (existing) {
      this.database.prepare('UPDATE tasks SET project_id=?,title=?,updated_at=? WHERE id=?').run(projectId, name, updatedAt, existing.id)
      return this.getTask(existing.id)
    }
    const id = randomUUID()
    this.database.prepare("INSERT INTO tasks(id,project_id,title,claude_session_id,status,created_at,updated_at) VALUES(?,?,?,?,'idle',?,?)").run(id, projectId, name, sessionId, updatedAt, updatedAt)
    return this.getTask(id)
  }

  renameTask(id: string, title: string): TaskDto {
    const value = title.trim()
    if (!value) throw new AppError('invalid_title', '任务标题不能为空', true)
    const result = this.database.prepare('UPDATE tasks SET title=?,updated_at=? WHERE id=?').run(value, new Date().toISOString(), id)
    if (result.changes === 0) throw new AppError('task_not_found', '任务不存在', true)
    return this.getTask(id)
  }

  deleteTask(id: string) {
    const task = this.getTask(id)
    if (ACTIVE_STATUSES.has(task.status)) throw new AppError('task_active', '请先停止正在运行的会话', true)
    this.database.prepare('DELETE FROM tasks WHERE id=?').run(id)
  }

  transitionTask(id: string, status: TaskStatus) {
    this.database.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id)
    return this.getTask(id)
  }

  updateTaskSession(id: string, sessionId: string) {
    this.database.prepare('UPDATE tasks SET claude_session_id=?,updated_at=? WHERE id=?').run(sessionId, new Date().toISOString(), id)
  }

  setTaskModel(id: string, model: string | null) { this.database.prepare('UPDATE tasks SET model_override=?,updated_at=? WHERE id=?').run(model, new Date().toISOString(), id); return this.getTask(id) }
  setTaskPermissionMode(id: string, mode: TaskPermissionMode | null) { this.database.prepare('UPDATE tasks SET permission_mode_override=?,updated_at=? WHERE id=?').run(mode, new Date().toISOString(), id); return this.getTask(id) }

  appendEvent(event: TaskEvent) {
    try {
      return Number(this.database.prepare('INSERT INTO events(task_id,run_id,sequence,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(event.taskId, event.runId, event.sequence, event.kind, JSON.stringify({ kind: event.kind, data: event.data }), event.createdAt).lastInsertRowid)
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new AppError('duplicate_event_sequence', '事件序号重复', false)
      throw error
    }
  }

  recoverInterruptedTasks() {
    return Number(this.database.prepare("UPDATE tasks SET status='interrupted',updated_at=? WHERE status IN ('starting','running','awaiting_permission','stopping')").run(new Date().toISOString()).changes)
  }

  listEvents(taskId: string, offset = 0, limit = 5000): TaskEvent[] {
    this.getTask(taskId)
    const rows = this.database.prepare('SELECT task_id,run_id,sequence,created_at,payload_json FROM events WHERE task_id=? ORDER BY id ASC LIMIT ? OFFSET ?').all(taskId, Math.min(5000, Math.max(0, limit)), Math.max(0, offset)) as unknown as EventRow[]
    return rows.map((row) => ({
      version: 1,
      taskId: row.task_id,
      runId: row.run_id,
      sequence: row.sequence,
      createdAt: row.created_at,
      ...(JSON.parse(row.payload_json) as { kind: string; data: Record<string, unknown> }),
    }))
  }

  loadSettings(): AppSettingsDto {
    const row = this.database.prepare("SELECT value_json FROM settings WHERE key='app'").get() as { value_json: string } | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) } as AppSettingsDto
  }

  saveSettings(settings: AppSettingsDto): AppSettingsDto {
    if (!Number.isInteger(settings.sidebarWidth) || settings.sidebarWidth < 220 || settings.sidebarWidth > 440) {
      throw new AppError('invalid_sidebar_width', '侧栏宽度必须在 220–440 像素之间', true)
    }
    if (settings.claudePath && !path.isAbsolute(settings.claudePath)) throw new AppError('invalid_cli_path', 'Claude 路径必须是绝对路径', true)
    if (!['system', 'dark', 'light'].includes(settings.theme)) throw new AppError('invalid_theme', '不支持的主题设置', true)
    if (!['zh-CN', 'en-US'].includes(settings.language)) throw new AppError('invalid_language', '不支持的语言设置', true)
    if (!['default', 'qoder', 'vscode', 'intellij_idea'].includes(settings.openWith)) throw new AppError('invalid_open_with', '不支持的项目打开方式', true)
    if (!['default', 'auto', 'bypass'].includes(settings.permissionMode)) throw new AppError('invalid_permission_mode', '不支持的权限模式', true)
    if (!['default', 'terminal', 'iterm', 'windows_terminal', 'command_prompt', 'powershell', 'gnome_terminal', 'konsole', 'alacritty', 'kitty', 'xterm'].includes(settings.terminalApp)) throw new AppError('invalid_terminal', '不支持的终端设置', true)
    const normalized = { ...DEFAULT_SETTINGS, ...settings }
    this.database.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('app',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(normalized), new Date().toISOString())
    return normalized
  }
}

const TASK_COLUMNS = 'id,project_id,title,claude_session_id,status,model_override,permission_mode_override,created_at,updated_at'
interface ProjectRow { id: string; name: string; canonical_path: string; created_at: string; last_opened_at: string }
interface TaskRow { id: string; project_id: string; title: string; claude_session_id: string | null; status: string; model_override: string | null; permission_mode_override: string | null; created_at: string; updated_at: string }
interface EventRow { task_id: string; run_id: string; sequence: number; created_at: string; payload_json: string }

function projectFromRow(row: ProjectRow): ProjectDto {
  return { id: row.id, name: row.name, path: row.canonical_path, createdAt: row.created_at, lastOpenedAt: row.last_opened_at }
}

function taskFromRow(row: TaskRow): TaskDto {
  const statuses = new Set<TaskStatus>(['idle', 'starting', 'running', 'awaiting_permission', 'stopping', 'completed', 'interrupted', 'failed'])
  const permissionModes = new Set<TaskPermissionMode>(['default', 'acceptEdits', 'plan', 'dontAsk'])
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    claudeSessionId: row.claude_session_id,
    status: statuses.has(row.status as TaskStatus) ? row.status as TaskStatus : 'idle',
    modelOverride: row.model_override,
    permissionModeOverride: permissionModes.has(row.permission_mode_override as TaskPermissionMode) ? row.permission_mode_override as TaskPermissionMode : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
