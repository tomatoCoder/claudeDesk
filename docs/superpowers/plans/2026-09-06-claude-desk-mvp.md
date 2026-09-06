# Claude Desk MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable Tauri desktop client for macOS Apple Silicon and Windows x64 that drives a user-installed Claude Code CLI through a Codex-style project and task interface.

**Architecture:** Vue 3 renders projects, conversations, approvals, diffs, and diagnostics. A Tauri Rust core owns all filesystem, SQLite, Git, process, and permission-broker operations; each active turn runs a Claude CLI child process with JSONL streaming and resumes by session ID. The renderer receives versioned task events through one typed Tauri event channel and has no general shell capability.

**Tech Stack:** Tauri 2, Rust 1.88+, Vue 3.5, TypeScript, Pinia 4, Vite 8, Vitest 5, Vue Test Utils, SQLite via `rusqlite`, Tokio, official Rust MCP SDK `rmcp` 3, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-06-claude-desk-design.md`

## Global Constraints

- Product name is `Claude Desk`; Tauri identifier is `com.claudedesk.desktop`.
- Target macOS 13.0+ on Apple Silicon and Windows 10 1809+/Windows 11 on x64.
- Require a separately installed and authenticated native Claude Code CLI; do not bundle it or implement a login flow.
- Require Claude Code `>= 2.1.112`; the current development machine has `2.1.228`.
- Support direct working-directory mode only; do not create worktrees or filesystem snapshots.
- Never expose a general shell API to Vue, persist Claude credentials, or offer `bypassPermissions`.
- Task-level allow rules live only in the current application process and never become active again after restart.
- Git integration is read-only and labels all changes as current-workspace changes.
- Raw logs stay local, rotate at 5 MiB per task, and are cleared only by explicit user action or task deletion.
- Produce ad-hoc-signed macOS `.app`/`.dmg` and unsigned Windows per-user NSIS `-setup.exe`; do not publish a GitHub Release.
- Use test-driven development: every behavior change starts with a failing focused test, then minimal implementation, then focused and full verification.
- The current development machine has Node `24.14.0`, pnpm `11.8.0`, and Claude Code `2.1.228`, but no Rust toolchain. Execution must install Rust stable `>= 1.88` with the user's approval before Task 1 verification.

## Scope Check

This remains one implementation plan because the renderer, storage, process runner, permission bridge, and packaging are sequentially dependent parts of one installable vertical product. Each task below ends in an independently reviewable capability and a commit; none of the subsystems is useful as a separate product.

## Locked File Map

### Root and frontend

- `package.json` — pinned frontend and Tauri CLI dependencies plus verification scripts.
- `pnpm-lock.yaml` — reproducible JavaScript dependency graph.
- `index.html`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts` — Vue/Vite build and test configuration.
- `src/main.ts`, `src/App.vue` — application bootstrap and top-level shell.
- `src/domain/models.ts` — project, task, settings, and diagnostic DTOs.
- `src/domain/events.ts` — versioned discriminated task-event union.
- `src/services/ipc.ts` — typed wrappers for every Tauri command.
- `src/services/taskEvents.ts` — single `task-event` subscription and sequence filtering.
- `src/stores/projects.ts`, `src/stores/tasks.ts`, `src/stores/runtime.ts` — persistent snapshots and ephemeral run state.
- `src/components/sidebar/*` — project/task navigation and status.
- `src/components/conversation/*` — timeline, message, tool, composer, and raw event cards.
- `src/components/permissions/*` — permission and `AskUserQuestion` cards.
- `src/components/diff/*` — workspace status, file list, and patch viewer.
- `src/components/diagnostics/*` — CLI status, settings, and bounded logs.
- `src/styles/tokens.css`, `src/styles/app.css` — black/charcoal/orange visual system.

### Rust backend

- `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json` — crate and bundle configuration.
- `src-tauri/capabilities/default.json` — least-privilege Tauri capability declaration.
- `src-tauri/src/main.rs` — selects GUI mode or permission-helper mode.
- `src-tauri/src/lib.rs` — Tauri setup, managed state, commands, and shutdown hook.
- `src-tauri/src/domain.rs` — Rust DTOs matching the TypeScript contracts.
- `src-tauri/src/error.rs` — stable error codes and renderer-safe messages.
- `src-tauri/src/storage/*` — SQLite connection, migrations, and repositories.
- `src-tauri/src/claude/*` — CLI discovery, version checks, invocation construction, and JSONL parsing.
- `src-tauri/src/process/*` — child execution, cancellation, process groups, and Windows Job Objects.
- `src-tauri/src/task/*` — state machine, active-run registry, event persistence, and emission.
- `src-tauri/src/permission/*` — in-memory grants, loopback bridge, temporary MCP config, and stdio helper.
- `src-tauri/src/git/*` — read-only status and diff commands.
- `src-tauri/src/diagnostics/*` — settings diagnostics and rotating task logs.
- `src-tauri/src/commands/*` — validated Tauri command adapters.
- `src-tauri/src/bin/fake_claude.rs` — deterministic integration-test subprocess.

### Tests, automation, and documentation

- `src/**/*.spec.ts` — colocated Vue, store, contract, and service tests.
- `src-tauri/tests/*.rs` — storage, CLI, process, permission, coordinator, and Git integration tests.
- `tests/fixtures/claude/*.jsonl` — representative known and unknown Claude stream events.
- `tests/e2e/workspace.spec.ts` — browser-level core UI flow with mocked IPC.
- `playwright.config.ts` — browser-level test configuration.
- `.github/workflows/build-installers.yml` — test and native bundle matrix without releases.
- `docs/testing/platform-smoke.md` — exact macOS and Windows real-CLI acceptance checklist.
- `README.md` — prerequisites, development, build, install warnings, and private-use boundary.

---

### Task 1: Scaffold the verified Tauri/Vue application shell

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/App.spec.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `.gitignore`

**Interfaces:**
- Consumes: only the global constraints and the approved design.
- Produces: `claude_desk_lib::run()`, a Vue mount point `#app`, and scripts `dev`, `build`, `test`, `typecheck`, `tauri`, and `verify`.

- [ ] **Step 1: Verify or install the required toolchain**

Run:

```bash
node --version
pnpm --version
rustc --version
cargo --version
claude --version
```

Expected: Node `>=22`, pnpm `>=11`, Rust `>=1.88`, Cargo matching Rust, and Claude Code `>=2.1.112`. On the current machine Rust is absent, so request approval and install stable Rust with the official rustup installer before continuing; do not hide that system change inside a project script.

- [ ] **Step 2: Write the failing application-shell test**

```ts
// src/App.spec.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'

describe('App', () => {
  it('renders the Claude Desk shell', () => {
    const wrapper = mount(App)
    expect(wrapper.get('[data-testid="app-shell"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Claude Desk')
  })
})
```

- [ ] **Step 3: Create package and test configuration, then prove the test fails**

Use these dependency floors in `package.json` and let `pnpm-lock.yaml` pin exact transitive versions:

```json
{
  "name": "claude-desk",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "vue-tsc --noEmit",
    "tauri": "tauri",
    "verify": "pnpm test && pnpm typecheck && pnpm build"
  },
  "dependencies": {
    "@tauri-apps/api": "2.11.1",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-opener": "^2.0.0",
    "dompurify": "^3.2.0",
    "lucide-vue-next": "^0.540.0",
    "markdown-it": "15.0.1",
    "pinia": "4.0.3",
    "vue": "3.5.42"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.11.4",
    "@types/markdown-it": "14.2.0",
    "@vitejs/plugin-vue": "^6.0.0",
    "@vue/test-utils": "^2.4.0",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vitest": "5.0.0",
    "vue-tsc": "3.3.11"
  }
}
```

Run:

```bash
pnpm install
pnpm test src/App.spec.ts
```

Expected: FAIL because `src/App.vue` and the application shell do not exist yet.

- [ ] **Step 4: Implement the minimum Vue shell and theme tokens**

```vue
<!-- src/App.vue -->
<template>
  <main class="app-shell" data-testid="app-shell">
    <aside class="sidebar"><span class="brand-mark">✦</span> Claude Desk</aside>
    <section class="workspace">选择项目以开始</section>
  </main>
</template>

<style scoped>
.app-shell { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
.sidebar { background: var(--surface-sidebar); padding: 18px; }
.workspace { background: var(--surface-root); padding: 24px; }
.brand-mark { color: var(--accent); }
</style>
```

```css
/* src/styles/tokens.css */
:root {
  color-scheme: dark;
  --surface-root: #0b0b0a;
  --surface-sidebar: #151412;
  --surface-raised: #201e1b;
  --text-primary: #f5f2ec;
  --text-secondary: #9f9a91;
  --accent: #f97316;
  --warning: #d69e2e;
  --danger: #b94b4b;
}
```

- [ ] **Step 5: Run the focused frontend test**

Run: `pnpm test src/App.spec.ts`

Expected: PASS with 1 test.

- [ ] **Step 6: Add the minimum Tauri crate and least-privilege config**

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("failed to run Claude Desk");
}
```

```rust
// src-tauri/src/main.rs
fn main() {
    claude_desk_lib::run();
}
```

Set `productName` to `Claude Desk`, `identifier` to `com.claudedesk.desktop`, `bundle.active` to `true`, and macOS `minimumSystemVersion` to `13.0`. The default capability must grant only core window access, dialog open, and opener URL access; it must not grant the shell plugin.

- [ ] **Step 7: Verify both build surfaces**

Run:

```bash
pnpm verify
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all frontend tests, type checking, Vite build, and Rust check exit 0.

- [ ] **Step 8: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml index.html tsconfig.json tsconfig.node.json vite.config.ts src src-tauri .gitignore
git commit -m "chore: scaffold Claude Desk Tauri app"
```

---

### Task 2: Define stable cross-boundary domain contracts

**Files:**
- Create: `src/domain/models.ts`
- Create: `src/domain/events.ts`
- Create: `src/domain/events.spec.ts`
- Create: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/domain_contract.rs`
- Create: `tests/fixtures/contracts/task-event.json`

**Interfaces:**
- Consumes: Vue and Rust project shells from Task 1.
- Produces: `ProjectDto`, `TaskDto`, `TaskStatus`, `AppSettingsDto`, `CliDiagnosticDto`, `AppSnapshot`, `RunAccepted`, `TaskEvent`, `TaskEventData`, `PermissionDecisionKind`, and JSON field names shared by all later tasks.

- [ ] **Step 1: Add a fixture and failing TypeScript contract test**

```json
{
  "version": 1,
  "taskId": "task-1",
  "runId": "run-1",
  "sequence": 4,
  "createdAt": "2026-09-06T12:00:00Z",
  "kind": "assistant_delta",
  "data": { "messageId": "msg-1", "text": "hello" }
}
```

```ts
// src/domain/events.spec.ts
import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/contracts/task-event.json'
import { isTaskEvent } from './events'

describe('task event contract', () => {
  it('accepts the version-one fixture', () => {
    expect(isTaskEvent(fixture)).toBe(true)
  })
  it('rejects an unknown contract version', () => {
    expect(isTaskEvent({ ...fixture, version: 2 })).toBe(false)
  })
})
```

Run: `pnpm test src/domain/events.spec.ts`

Expected: FAIL because `events.ts` does not exist.

- [ ] **Step 2: Implement the TypeScript contracts and guard**

```ts
// src/domain/events.ts
export type TaskStatus = 'idle' | 'starting' | 'running' | 'awaiting_permission' |
  'stopping' | 'completed' | 'interrupted' | 'failed'
export type PermissionDecisionKind = 'allow_once' | 'allow_task' | 'deny'

export interface UserQuestion {
  question: string
  header: string
  options: Array<{ label: string; description: string; preview?: string }>
  multiSelect: boolean
}

export type TaskEventData =
  | { kind: 'user_message'; text: string }
  | { kind: 'assistant_delta'; messageId: string; text: string }
  | { kind: 'assistant_message'; messageId: string; markdown: string }
  | { kind: 'tool_started'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_finished'; toolUseId: string; output: unknown; isError: boolean }
  | { kind: 'permission_requested'; requestId: string; toolName: string; input: unknown; suggestions: string[] }
  | { kind: 'permission_resolved'; requestId: string; decision: PermissionDecisionKind }
  | { kind: 'question_requested'; requestId: string; questions: UserQuestion[] }
  | { kind: 'workspace_conflict'; projectId: string; activeTaskIds: string[] }
  | { kind: 'status_changed'; status: TaskStatus }
  | { kind: 'result'; sessionId: string; costUsd: number | null; turns: number | null }
  | { kind: 'error'; code: string; message: string; recoverable: boolean }
  | { kind: 'unknown'; raw: unknown }

interface TaskEventEnvelope {
  version: 1
  taskId: string
  runId: string
  sequence: number
  createdAt: string
}

type EventData<K extends TaskEventData['kind']> = Omit<Extract<TaskEventData, { kind: K }>, 'kind'>
export type TaskEvent = {
  [K in TaskEventData['kind']]: TaskEventEnvelope & { kind: K; data: EventData<K> }
}[TaskEventData['kind']]

export function isTaskEvent(value: unknown): value is TaskEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return event.version === 1 && typeof event.taskId === 'string' &&
    typeof event.runId === 'string' && Number.isInteger(event.sequence) &&
    typeof event.kind === 'string' && typeof event.data === 'object'
}
```

```ts
// src/domain/models.ts
import type { TaskStatus } from './events'

export interface ProjectDto {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}
export interface TaskDto {
  id: string
  projectId: string
  title: string
  claudeSessionId: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
}
export interface AppSettingsDto { claudePath: string | null; sidebarWidth: number }
export interface CliDiagnosticDto {
  status: 'ready' | 'not_found' | 'too_old' | 'probe_failed' | 'not_authenticated'
  path: string | null
  version: string | null
  message: string
}
export interface AppSnapshot {
  projects: ProjectDto[]
  tasks: TaskDto[]
  settings: AppSettingsDto
  cli: CliDiagnosticDto
}
export interface RunAccepted { runId: string }
```

Define `ProjectDto`, `TaskDto`, `AppSettingsDto`, and `CliDiagnosticDto` in `models.ts` with camelCase JSON names and ISO-8601 timestamp strings.

- [ ] **Step 3: Implement matching Rust DTOs and serialization test**

```rust
// src-tauri/src/domain.rs
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub version: u8,
    pub task_id: String,
    pub run_id: String,
    pub sequence: u64,
    pub created_at: String,
    #[serde(flatten)]
    pub payload: TaskEventPayload,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Idle,
    Starting,
    Running,
    AwaitingPermission,
    Stopping,
    Completed,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum TaskEventPayload {
    UserMessage { text: String },
    AssistantDelta { message_id: String, text: String },
    AssistantMessage { message_id: String, markdown: String },
    ToolStarted { tool_use_id: String, tool_name: String, input: serde_json::Value },
    ToolFinished { tool_use_id: String, output: serde_json::Value, is_error: bool },
    PermissionRequested { request_id: String, tool_name: String, input: serde_json::Value, suggestions: Vec<String> },
    PermissionResolved { request_id: String, decision: PermissionDecisionKind },
    QuestionRequested { request_id: String, questions: Vec<UserQuestion> },
    WorkspaceConflict { project_id: String, active_task_ids: Vec<String> },
    StatusChanged { status: TaskStatus },
    Result { session_id: String, cost_usd: Option<f64>, turns: Option<u64> },
    Error { code: String, message: String, recoverable: bool },
    Unknown { raw: serde_json::Value },
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecisionKind { AllowOnce, AllowTask, Deny }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestion {
    pub question: String,
    pub header: String,
    pub options: Vec<UserQuestionOption>,
    pub multi_select: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestionOption {
    pub label: String,
    pub description: String,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub claude_session_id: Option<String>,
    pub status: TaskStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub claude_path: Option<String>,
    pub sidebar_width: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliDiagnosticDto {
    pub status: CliDiagnosticStatus,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CliDiagnosticStatus { Ready, NotFound, TooOld, ProbeFailed, NotAuthenticated }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub projects: Vec<ProjectDto>,
    pub tasks: Vec<TaskDto>,
    pub settings: AppSettingsDto,
    pub cli: CliDiagnosticDto,
}

impl TaskEventPayload {
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::UserMessage { .. } => "user_message",
            Self::AssistantDelta { .. } => "assistant_delta",
            Self::AssistantMessage { .. } => "assistant_message",
            Self::ToolStarted { .. } => "tool_started",
            Self::ToolFinished { .. } => "tool_finished",
            Self::PermissionRequested { .. } => "permission_requested",
            Self::PermissionResolved { .. } => "permission_resolved",
            Self::QuestionRequested { .. } => "question_requested",
            Self::WorkspaceConflict { .. } => "workspace_conflict",
            Self::StatusChanged { .. } => "status_changed",
            Self::Result { .. } => "result",
            Self::Error { .. } => "error",
            Self::Unknown { .. } => "unknown",
        }
    }
}
```

In `domain_contract.rs`, deserialize `tests/fixtures/contracts/task-event.json`, assert `AssistantDelta`, serialize it again, and compare `version`, `taskId`, `runId`, `sequence`, `kind`, and `data` exactly.

- [ ] **Step 4: Run both contract suites**

Run:

```bash
pnpm test src/domain/events.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml --test domain_contract
```

Expected: both suites pass.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/domain src-tauri/src/domain.rs src-tauri/src/lib.rs src-tauri/tests/domain_contract.rs tests/fixtures/contracts/task-event.json
git commit -m "feat: define desktop domain contracts"
```

---

### Task 3: Persist projects, tasks, events, and settings in SQLite

**Files:**
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/migrations.rs`
- Create: `src-tauri/src/storage/repository.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/storage_repository.rs`

**Interfaces:**
- Consumes: Rust DTOs from Task 2.
- Produces: `Storage::open`, `create_or_touch_project`, `create_task`, `rename_task`, `delete_task`, `list_projects_with_tasks`, `append_event`, `list_events`, `update_task_session`, `transition_task`, `load_settings`, and `save_settings`.

- [ ] **Step 1: Write failing repository tests**

```rust
#[test]
fn canonical_project_path_is_unique_and_touch_updates_timestamp() {
    let db = test_storage();
    let first = db.create_or_touch_project("Demo", fixture_dir()).unwrap();
    let second = db.create_or_touch_project("Renamed", fixture_dir()).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(db.list_projects_with_tasks().unwrap().len(), 1);
}

#[test]
fn restart_marks_active_tasks_interrupted() {
    let db = test_storage();
    let task = seeded_task(&db);
    db.transition_task(&task.id, TaskStatus::Running).unwrap();
    assert_eq!(db.recover_interrupted_tasks().unwrap(), 1);
    assert_eq!(db.get_task(&task.id).unwrap().status, TaskStatus::Interrupted);
}
```

Add these focused cases:

```rust
#[test]
fn duplicate_event_sequence_is_rejected() {
    let db = test_storage();
    let event = seeded_event(&db, "run-1", 1);
    db.append_event(&event).unwrap();
    assert_eq!(db.append_event(&event).unwrap_err().code(), "duplicate_event_sequence");
}

#[test]
fn deleting_task_cascades_events() {
    let db = test_storage();
    let task = seeded_task(&db);
    db.append_event(&event_for(&task, 1)).unwrap();
    db.delete_task(&task.id).unwrap();
    assert!(db.list_events(&task.id, 0, 50).unwrap().is_empty());
}

#[test]
fn settings_round_trip_as_json() {
    let db = test_storage();
    let settings = AppSettingsDto { claude_path: Some("/custom/claude".into()), sidebar_width: 320 };
    db.save_settings(&settings).unwrap();
    assert_eq!(db.load_settings().unwrap(), settings);
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test storage_repository`

Expected: FAIL because `Storage` is undefined.

- [ ] **Step 2: Create the version-one migration**

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  claude_session_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, run_id, sequence)
);
CREATE INDEX events_task_order ON events(task_id, id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 1;
```

Open SQLite with foreign keys enabled and WAL journal mode. Use `Arc<parking_lot::Mutex<rusqlite::Connection>>`; never hold its lock across `.await`.

- [ ] **Step 3: Implement repository methods with explicit transactions**

```rust
#[derive(Clone)]
pub struct Storage {
    connection: std::sync::Arc<parking_lot::Mutex<rusqlite::Connection>>,
}

impl Storage {
    pub fn append_event(&self, event: &TaskEvent) -> Result<i64, AppError> {
        let payload = serde_json::to_string(&event.payload)?;
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO events(task_id, run_id, sequence, kind, payload_json, created_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![&event.task_id, &event.run_id, event.sequence, event.payload.kind(), payload, &event.created_at],
        )?;
        Ok(connection.last_insert_rowid())
    }
}
```

Canonicalize paths before insertion. Map SQLite constraint errors to stable `AppError` codes rather than exposing raw database text to Vue.

- [ ] **Step 4: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test storage_repository
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 5: Commit storage**

```bash
git add src-tauri/Cargo.toml src-tauri/src/storage src-tauri/src/lib.rs src-tauri/tests/storage_repository.rs
git commit -m "feat: persist projects tasks and events"
```

---

### Task 4: Locate and diagnose the installed Claude CLI

**Files:**
- Create: `src-tauri/src/claude/mod.rs`
- Create: `src-tauri/src/claude/locator.rs`
- Create: `src-tauri/src/claude/version.rs`
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/claude_locator.rs`

**Interfaces:**
- Consumes: saved `AppSettingsDto.claudePath` from Task 3.
- Produces: `ClaudeLocator::locate(settings, environment) -> Result<CliDiagnosticDto, AppError>`, `CliVersion::parse`, renderer-safe `CommandError`, and error codes `cli_not_found`, `cli_too_old`, `cli_probe_failed`, and `cli_not_authenticated`.

- [ ] **Step 1: Write failing version and precedence tests**

```rust
#[test]
fn custom_path_wins_over_path_candidates() {
    let probe = FakeProbe::with_versions([("/custom/claude", "2.1.228"), ("/path/claude", "2.1.228")]);
    let result = ClaudeLocator::new(probe).locate(Some("/custom/claude".into()), vec!["/path/claude".into()]).unwrap();
    assert_eq!(result.path, "/custom/claude");
}

#[test]
fn rejects_versions_before_permission_suggestions_floor() {
    assert!(!CliVersion::parse("2.1.111 (Claude Code)").unwrap().is_supported());
    assert!(CliVersion::parse("2.1.112 (Claude Code)").unwrap().is_supported());
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test claude_locator`

Expected: FAIL because locator types do not exist.

- [ ] **Step 2: Implement deterministic candidate collection**

```rust
pub fn ordered_candidates(custom: Option<PathBuf>, path_entries: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = custom { candidates.push(path); }
    candidates.extend(path_entries.iter().cloned());
    #[cfg(target_os = "macos")]
    candidates.extend([PathBuf::from("/opt/homebrew/bin/claude"), PathBuf::from("/usr/local/bin/claude")]);
    deduplicate_paths(candidates)
}
```

On macOS, query the login shell only with a fixed `command -v claude` command and parse one absolute result. On Windows, collect `where.exe claude` results and known native user install locations. Do not accept a relative path.

- [ ] **Step 3: Implement probing and error classification**

```rust
pub trait ClaudeProbe: Send + Sync {
    fn version(&self, executable: &Path) -> Result<CliVersion, AppError>;
}

pub const MINIMUM_CLAUDE_VERSION: CliVersion = CliVersion::new(2, 1, 112);
```

Define `AppError` as the internal error-with-source type and add this serialization boundary now so all later commands use the same shape:

```rust
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub correlation_id: String,
}
```

Run the candidate with the argument vector `['--version']`, a five-second timeout, inherited user environment, and captured output. After the version passes, run `['auth', 'status']`; exit code 0 means authenticated and exit code 1 maps to `cli_not_authenticated`. Other nonzero exits are `cli_probe_failed`; no candidates is `cli_not_found`; a lower semantic version is `cli_too_old`. Do not persist the JSON body from `auth status`, because only the success state is needed.

- [ ] **Step 4: Run locator tests and a local diagnostic smoke check**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test claude_locator
claude --version
```

Expected: tests pass and the local diagnostic reports `2.1.228`.

- [ ] **Step 5: Commit CLI discovery**

```bash
git add src-tauri/src/claude src-tauri/src/error.rs src-tauri/src/lib.rs src-tauri/tests/claude_locator.rs
git commit -m "feat: detect supported Claude CLI"
```

---

### Task 5: Build Claude invocations and normalize stream-json events

**Files:**
- Create: `src-tauri/src/claude/invocation.rs`
- Create: `src-tauri/src/claude/parser.rs`
- Modify: `src-tauri/src/claude/mod.rs`
- Create: `src-tauri/tests/claude_invocation.rs`
- Create: `src-tauri/tests/claude_parser.rs`
- Create: `tests/fixtures/claude/basic-turn.jsonl`
- Create: `tests/fixtures/claude/unknown-event.jsonl`

**Interfaces:**
- Consumes: `TaskEventPayload` from Task 2 and a verified CLI path from Task 4.
- Produces: `ClaudeInvocation::new`, `ClaudeInvocation::args`, `ClaudeInvocation::stdin_message`, `StreamParser::push`, and `StreamParser::finish`.

- [ ] **Step 1: Write failing safe-invocation tests**

```rust
#[test]
fn prompt_is_written_to_stdin_and_never_appears_in_arguments() {
    let invocation = ClaudeInvocation::new("hello; rm -rf x", None, None);
    assert!(!invocation.args().iter().any(|arg| arg.contains("rm -rf")));
    let input: serde_json::Value = serde_json::from_slice(&invocation.stdin_message()).unwrap();
    assert_eq!(input["message"]["content"], "hello; rm -rf x");
}

#[test]
fn resume_is_an_independent_argument() {
    let invocation = ClaudeInvocation::new("continue", Some("session-123"), None);
    assert!(invocation.args().windows(2).any(|pair| pair == ["--resume", "session-123"]));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test claude_invocation`

Expected: FAIL because `ClaudeInvocation` is undefined.

- [ ] **Step 2: Implement the invocation and streaming input envelope**

```rust
pub fn args(&self) -> Vec<OsString> {
    let mut args = vec![
        "-p".into(),
        "--input-format".into(), "stream-json".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--permission-mode".into(), "dontAsk".into(),
    ];
    if let Some(session_id) = &self.session_id {
        args.extend(["--resume".into(), session_id.into()]);
    }
    args
}

pub fn stdin_message(&self) -> Vec<u8> {
    let message = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": self.prompt },
        "parent_tool_use_id": null
    });
    format!("{}\n", message).into_bytes()
}
```

`dontAsk` is an intentional temporary safety mode for Tasks 5–9; Task 10 replaces it with the native permission bridge before real write-capable acceptance testing.

- [ ] **Step 3: Add representative JSONL fixtures and failing parser tests**

Create `basic-turn.jsonl` with these five complete lines, covering initialization, partial text, tool use, tool result, and result usage:

```jsonl
{"type":"system","subtype":"init","session_id":"abc","cwd":"/tmp/demo"}
{"type":"stream_event","uuid":"m1","session_id":"abc","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}}
{"type":"assistant","uuid":"m1","session_id":"abc","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"README.md"}}]}}
{"type":"user","uuid":"u1","session_id":"abc","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"contents","is_error":false}]}}
{"type":"result","subtype":"success","session_id":"abc","total_cost_usd":0.01,"num_turns":1}
```

Test arbitrary chunk boundaries:

```rust
#[test]
fn parses_lines_split_across_chunks() {
    let mut parser = StreamParser::default();
    assert!(parser.push(br#"{"type":"system","subtype":"init","session_"#).unwrap().is_empty());
    let events = parser.push(br#"id":"abc"}\n"#).unwrap();
    assert!(events.iter().any(|event| matches!(event, ParsedClaudeEvent::SessionStarted { session_id } if session_id == "abc")));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test claude_parser`

Expected: FAIL because `StreamParser` is undefined.

- [ ] **Step 4: Implement tolerant JSONL normalization**

```rust
pub enum ParsedClaudeEvent {
    SessionStarted { session_id: String },
    AssistantDelta { message_id: String, text: String },
    AssistantMessage { message_id: String, markdown: String },
    ToolStarted { tool_use_id: String, tool_name: String, input: serde_json::Value },
    ToolFinished { tool_use_id: String, output: serde_json::Value, is_error: bool },
    Result { session_id: String, cost_usd: Option<f64>, turns: Option<u64> },
    ApiRetry { attempt: u64, message: String },
    Unknown(serde_json::Value),
}
```

Keep an internal byte buffer, split only on newline, reject a single line above 2 MiB, and turn syntactically valid unknown objects into `Unknown`. `finish()` reports a final incomplete non-whitespace line as `stream_truncated` and preserves it for raw diagnostics.

- [ ] **Step 5: Run invocation and parser tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test claude_invocation
cargo test --manifest-path src-tauri/Cargo.toml --test claude_parser
```

Expected: all tests pass.

- [ ] **Step 6: Commit CLI protocol support**

```bash
git add src-tauri/src/claude src-tauri/tests/claude_invocation.rs src-tauri/tests/claude_parser.rs tests/fixtures/claude
git commit -m "feat: parse Claude streaming protocol"
```

---

### Task 6: Execute and cancel Claude child processes with a fake CLI

**Files:**
- Create: `src-tauri/src/process/mod.rs`
- Create: `src-tauri/src/process/runner.rs`
- Create: `src-tauri/src/process/cancellation.rs`
- Create: `src-tauri/src/bin/fake_claude.rs`
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/tests/process_runner.rs`

**Interfaces:**
- Consumes: `ClaudeInvocation` and `StreamParser` from Task 5.
- Produces: `ProcessRunner::run(request, sink, cancellation) -> RunOutcome`, `CancellationHandle::cancel`, `ProcessLineSink`, and the deterministic `fake_claude` test binary.

- [ ] **Step 1: Write failing process-stream and cancellation tests**

```rust
#[tokio::test]
async fn streams_stdout_stderr_and_returns_exit_status() {
    let sink = RecordingSink::default();
    let outcome = runner_for_fake("success").run(request(), sink.clone(), CancellationHandle::new()).await.unwrap();
    assert!(outcome.status.success());
    assert!(sink.stdout().contains("\"type\":\"result\""));
    assert!(sink.stderr().contains("diagnostic-line"));
}

#[tokio::test]
async fn cancellation_finishes_without_waiting_for_hanging_child() {
    let cancellation = CancellationHandle::new();
    let run = tokio::spawn(runner_for_fake("hang").run(request(), RecordingSink::default(), cancellation.clone()));
    cancellation.cancel();
    assert!(tokio::time::timeout(Duration::from_secs(3), run).await.is_ok());
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test process_runner`

Expected: FAIL because the runner and fake CLI do not exist.

- [ ] **Step 2: Implement deterministic fake CLI scenarios**

```rust
// src-tauri/src/bin/fake_claude.rs
fn main() {
    let scenario = std::env::var("CLAUDE_DESK_FAKE_SCENARIO").unwrap_or_else(|_| "success".into());
    eprintln!("diagnostic-line");
    println!(r#"{"type":"system","subtype":"init","session_id":"fake-session"}"#);
    if scenario == "hang" {
        std::thread::sleep(std::time::Duration::from_secs(60));
        return;
    }
    println!(r#"{"type":"result","subtype":"success","session_id":"fake-session","total_cost_usd":0.01,"num_turns":1}"#);
}
```

Add `success`, `split`, `stderr-flood`, `exit-error`, and `hang` scenarios. The fake binary must never access the network.

- [ ] **Step 3: Implement concurrent pipe reading and cancellation**

```rust
pub struct RunRequest {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
    pub stdin: Vec<u8>,
    pub environment: HashMap<OsString, OsString>,
}

#[async_trait::async_trait]
pub trait ProcessLineSink: Send + Sync {
    async fn stdout(&self, bytes: &[u8]) -> Result<(), AppError>;
    async fn stderr(&self, bytes: &[u8]) -> Result<(), AppError>;
}
```

Spawn with piped stdin/stdout/stderr, write the complete input, close stdin, and drain both output pipes concurrently. Use `tokio::select!` between process completion and cancellation. In this task cancellation uses `child.kill()`; Task 13 replaces that internals-only detail with full process-tree cleanup without changing the interface.

- [ ] **Step 4: Run focused process tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test process_runner`

Expected: all success, error, split-output, stderr-flood, and cancellation tests pass.

- [ ] **Step 5: Commit the runner**

```bash
git add src-tauri/Cargo.toml src-tauri/src/process src-tauri/src/bin/fake_claude.rs src-tauri/tests/process_runner.rs
git commit -m "feat: supervise Claude child processes"
```

---

### Task 7: Coordinate task runs, persist events, and expose Tauri commands

**Files:**
- Create: `src-tauri/src/task/mod.rs`
- Create: `src-tauri/src/task/state_machine.rs`
- Create: `src-tauri/src/task/coordinator.rs`
- Create: `src-tauri/src/task/event_sink.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/projects.rs`
- Create: `src-tauri/src/commands/tasks.rs`
- Create: `src-tauri/src/commands/events.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/task_coordinator.rs`

**Interfaces:**
- Consumes: storage, locator, invocation, parser, and process runner from Tasks 3–6.
- Produces: `TaskCoordinator::start_turn`, `stop_task`, `active_runs`, `PersistingEventSink`, and Tauri commands `bootstrap`, `add_project`, `create_task`, `rename_task`, `delete_task`, `list_events`, `start_turn`, and `stop_task`.

- [ ] **Step 1: Write failing state-transition and concurrency tests**

```rust
#[test]
fn rejects_a_second_run_for_the_same_task() {
    let machine = TaskStateMachine::new(TaskStatus::Running);
    assert_eq!(machine.transition(TaskStatus::Starting).unwrap_err().code(), "task_already_running");
}

#[tokio::test]
async fn two_different_tasks_can_run_at_the_same_time() {
    let coordinator = coordinator_with_fake_cli("hang");
    let first = coordinator.start_turn("task-a", "first").await.unwrap();
    let second = coordinator.start_turn("task-b", "second").await.unwrap();
    assert_ne!(first.run_id, second.run_id);
    assert_eq!(coordinator.active_runs().await.len(), 2);
    coordinator.stop_task("task-a").await.unwrap();
    coordinator.stop_task("task-b").await.unwrap();
}
```

Add these exact resume and recovery cases:

```rust
#[tokio::test]
async fn stored_session_id_is_passed_to_resume() {
    let coordinator = coordinator_with_task_session("session-123");
    coordinator.start_turn("task-a", "continue").await.unwrap();
    let args = coordinator.recorded_invocations().await[0].args();
    assert!(args.windows(2).any(|pair| pair == ["--resume", "session-123"]));
}

#[test]
fn startup_recovers_stale_running_task() {
    let coordinator = coordinator_with_task_status(TaskStatus::Running);
    assert_eq!(coordinator.recover_on_startup().unwrap(), 1);
    assert_eq!(coordinator.task("task-a").unwrap().status, TaskStatus::Interrupted);
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test task_coordinator`

Expected: FAIL because `TaskCoordinator` is undefined.

- [ ] **Step 2: Implement the explicit task state machine**

```rust
pub fn can_transition(from: TaskStatus, to: TaskStatus) -> bool {
    matches!((from, to),
        (TaskStatus::Idle | TaskStatus::Completed | TaskStatus::Interrupted | TaskStatus::Failed, TaskStatus::Starting) |
        (TaskStatus::Starting, TaskStatus::Running | TaskStatus::Failed | TaskStatus::Stopping) |
        (TaskStatus::Running, TaskStatus::AwaitingPermission | TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Stopping) |
        (TaskStatus::AwaitingPermission, TaskStatus::Running | TaskStatus::Failed | TaskStatus::Stopping) |
        (TaskStatus::Stopping, TaskStatus::Interrupted | TaskStatus::Failed)
    )
}
```

Every successful transition writes the task row and a `status_changed` event in one storage transaction.

- [ ] **Step 3: Implement persistence-before-emission event delivery**

```rust
#[async_trait::async_trait]
pub trait TaskEventEmitter: Send + Sync {
    async fn emit(&self, event: &TaskEvent) -> Result<(), AppError>;
}

pub async fn publish(&self, event: TaskEvent) -> Result<(), AppError> {
    self.storage.append_event(&event)?;
    self.emitter.emit(&event).await
}
```

Use the single Tauri event name `task-event`; include `taskId`, `runId`, and `sequence` in each payload. Never emit an event that failed to persist.

- [ ] **Step 4: Implement coordinator start, completion, and stop**

```rust
pub struct RunAccepted { pub run_id: String }

pub async fn start_turn(&self, task_id: &str, prompt: &str) -> Result<RunAccepted, AppError> {
    validate_prompt(prompt)?;
    let task = self.storage.get_task(task_id)?;
    self.reserve_run(&task).await?;
    let run_id = uuid::Uuid::new_v4().to_string();
    self.spawn_reserved_run(task, run_id.clone(), prompt.to_owned()).await?;
    Ok(RunAccepted { run_id })
}
```

The spawned run parses stdout, assigns sequence numbers, stores the first Session ID immediately, maps final exit state, and removes itself from the active registry exactly once.

- [ ] **Step 5: Add validated Tauri command adapters**

```rust
#[tauri::command]
async fn start_turn(state: tauri::State<'_, AppState>, task_id: String, prompt: String) -> Result<RunAccepted, CommandError> {
    state.coordinator.start_turn(&task_id, &prompt).await.map_err(Into::into)
}
```

Reject blank prompts, unknown IDs, non-directory project paths, and tasks already active. Register every listed command in `generate_handler!` and call `recover_interrupted_tasks()` during setup.

- [ ] **Step 6: Run coordinator and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test task_coordinator
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 7: Commit orchestration**

```bash
git add src-tauri/src/task src-tauri/src/commands src-tauri/src/lib.rs src-tauri/tests/task_coordinator.rs
git commit -m "feat: coordinate persistent Claude tasks"
```

---

### Task 8: Build project and task navigation in the left Sidebar

**Files:**
- Create: `src/services/ipc.ts`
- Create: `src/stores/projects.ts`
- Create: `src/stores/tasks.ts`
- Create: `src/components/sidebar/AppSidebar.vue`
- Create: `src/components/sidebar/ProjectGroup.vue`
- Create: `src/components/sidebar/TaskRow.vue`
- Create: `src/components/sidebar/AppSidebar.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: Task 7 commands and Task 2 DTOs.
- Produces: typed `ipc` methods, `useProjectsStore`, `useTasksStore`, `selectTask(taskId)`, and Sidebar events `new-task`, `rename-task`, and `delete-task`.

- [ ] **Step 1: Write a failing Sidebar behavior test**

```ts
it('groups tasks under projects and selects a task', async () => {
  const wrapper = mount(AppSidebar, {
    props: { projects: [projectFixture], tasks: [runningTaskFixture, idleTaskFixture], selectedTaskId: null }
  })
  expect(wrapper.get('[data-project-id="project-1"]').text()).toContain('Demo')
  await wrapper.get('[data-task-id="task-running"]').trigger('click')
  expect(wrapper.emitted('select-task')).toEqual([['task-running']])
})
```

Add these concrete assertions to the same spec:

```ts
expect(wrapper.get('[data-task-id="task-running"]').get('[data-testid="task-status"]').text()).toBe('运行中')
await wrapper.get('[data-action="collapse-project"]').trigger('click')
expect(wrapper.find('[data-task-id="task-running"]').exists()).toBe(false)
await wrapper.get('[data-action="new-task"]').trigger('click')
expect(wrapper.emitted('new-task')).toHaveLength(1)
await wrapper.get('[data-task-id="task-idle"] [data-action="rename-task"]').trigger('click')
expect(wrapper.emitted('rename-task')?.[0]).toEqual(['task-idle'])
await wrapper.get('[data-task-id="task-idle"] [data-action="delete-task"]').trigger('click')
expect(wrapper.get('[role="dialog"]').text()).toContain('删除任务')
expect(wrapper.get('[data-testid="cli-status"]').text()).toContain('Claude CLI')
```

Run: `pnpm test src/components/sidebar/AppSidebar.spec.ts`

Expected: FAIL because Sidebar components do not exist.

- [ ] **Step 2: Implement typed IPC wrappers**

```ts
export const ipc = {
  bootstrap: () => invoke<AppSnapshot>('bootstrap'),
  addProject: (path: string) => invoke<ProjectDto>('add_project', { path }),
  createTask: (projectId: string, title: string) => invoke<TaskDto>('create_task', { projectId, title }),
  renameTask: (taskId: string, title: string) => invoke<TaskDto>('rename_task', { taskId, title }),
  deleteTask: (taskId: string) => invoke<void>('delete_task', { taskId }),
  startTurn: (taskId: string, prompt: string) => invoke<RunAccepted>('start_turn', { taskId, prompt }),
  stopTask: (taskId: string) => invoke<void>('stop_task', { taskId }),
}
```

No Vue component may import `invoke` directly after this task.

- [ ] **Step 3: Implement stores and directory selection**

```ts
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectDto[]>([])
  async function chooseAndAddProject() {
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected !== 'string') return
    const project = await ipc.addProject(selected)
    projects.value = upsertById(projects.value, project)
  }
  return { projects, chooseAndAddProject }
})
```

Keep selected task ID in memory; the database remains the source of truth for projects and tasks.

- [ ] **Step 4: Implement Sidebar components and shell integration**

```vue
<aside class="sidebar" data-testid="sidebar">
  <header class="sidebar__brand"><span aria-hidden="true">✦</span><strong>Claude Desk</strong></header>
  <button class="primary-action" @click="$emit('new-task')">＋ 新建任务</button>
  <ProjectGroup v-for="project in projects" :key="project.id" :project="project" />
  <footer><span :class="['status-dot', cliStatus]" /> Claude CLI {{ cliLabel }}</footer>
</aside>
```

Use native buttons for keyboard access and `aria-current="page"` for the selected task.

- [ ] **Step 5: Run Sidebar tests and frontend verification**

Run:

```bash
pnpm test src/components/sidebar/AppSidebar.spec.ts
pnpm typecheck
pnpm build
```

Expected: tests, type checking, and build pass.

- [ ] **Step 6: Commit navigation**

```bash
git add src/services/ipc.ts src/stores src/components/sidebar src/App.vue src/styles/app.css
git commit -m "feat: add project task sidebar"
```

---

### Task 9: Render conversations and send streaming turns

**Files:**
- Create: `src/services/taskEvents.ts`
- Create: `src/services/taskEvents.spec.ts`
- Create: `src/stores/runtime.ts`
- Create: `src/components/conversation/ConversationView.vue`
- Create: `src/components/conversation/MessageBubble.vue`
- Create: `src/components/conversation/ToolCard.vue`
- Create: `src/components/conversation/ComposerBox.vue`
- Create: `src/components/conversation/ConversationView.spec.ts`
- Create: `src/components/conversation/markdown.ts`
- Create: `src/components/conversation/markdown.spec.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `task-event`, `list_events`, `start_turn`, and `stop_task` from Task 7.
- Produces: `subscribeToTaskEvents`, per-run sequence deduplication, `useRuntimeStore`, safe `renderMarkdown`, and conversation/composer components.

- [ ] **Step 1: Write failing sequence and streaming tests**

```ts
it('drops duplicate or stale task events', () => {
  const reducer = createTaskEventReducer()
  expect(reducer.accept(event({ sequence: 3 }))).toBe(true)
  expect(reducer.accept(event({ sequence: 3 }))).toBe(false)
  expect(reducer.accept(event({ sequence: 2 }))).toBe(false)
})

it('merges assistant deltas by message id', () => {
  const store = createRuntimeStore()
  store.consume(delta('m1', 'hel'))
  store.consume(delta('m1', 'lo'))
  expect(store.streamingText('m1')).toBe('hello')
})
```

Run: `pnpm test src/services/taskEvents.spec.ts src/components/conversation/ConversationView.spec.ts`

Expected: FAIL because the event service and components do not exist.

- [ ] **Step 2: Implement one event subscription with sequence filtering**

```ts
export async function subscribeToTaskEvents(consume: (event: TaskEvent) => void) {
  const latest = new Map<string, number>()
  return listen<TaskEvent>('task-event', ({ payload }) => {
    if (!isTaskEvent(payload)) return
    const key = `${payload.taskId}:${payload.runId}`
    if (payload.sequence <= (latest.get(key) ?? -1)) return
    latest.set(key, payload.sequence)
    consume(payload)
  })
}
```

Register once at app startup and always call the returned unlisten function during teardown.

- [ ] **Step 3: Write the failing Markdown security test, then implement safe rendering**

```ts
it('does not render scripts or javascript URLs', () => {
  const html = renderMarkdown('<script>alert(1)</script>[x](javascript:alert(2))')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('javascript:')
})
```

```ts
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  })
}
```

Run: `pnpm test src/components/conversation/markdown.spec.ts`

Expected: PASS after the implementation.

- [ ] **Step 4: Implement timeline, tool cards, composer, and stop behavior**

```vue
<form class="composer" @submit.prevent="submit">
  <textarea v-model="prompt" :disabled="status === 'starting'" aria-label="发送给 Claude" />
  <button v-if="isActive" type="button" @click="$emit('stop')">停止</button>
  <button v-else type="submit" :disabled="!prompt.trim()">发送</button>
</form>
```

Load persisted events first, then overlay current streaming deltas. Collapse tool inputs by default, render unknown events as a generic JSON card, and keep auto-scroll disabled when the user has scrolled away from the bottom.

- [ ] **Step 5: Run conversation and full frontend tests**

Run:

```bash
pnpm test src/services/taskEvents.spec.ts src/components/conversation
pnpm verify
```

Expected: all tests, types, and build pass.

- [ ] **Step 6: Commit conversation UI**

```bash
git add src/services/taskEvents.ts src/services/taskEvents.spec.ts src/stores/runtime.ts src/components/conversation src/App.vue
git commit -m "feat: stream Claude conversations"
```

---

### Task 10: Add native permission and user-question handling

**Files:**
- Create: `src-tauri/src/permission/mod.rs`
- Create: `src-tauri/src/permission/types.rs`
- Create: `src-tauri/src/permission/grants.rs`
- Create: `src-tauri/src/permission/hub.rs`
- Create: `src-tauri/src/permission/bridge.rs`
- Create: `src-tauri/src/permission/config.rs`
- Create: `src-tauri/src/permission/mcp_helper.rs`
- Create: `src-tauri/src/commands/permissions.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/claude/invocation.rs`
- Modify: `src-tauri/src/task/coordinator.rs`
- Create: `src-tauri/tests/permission_hub.rs`
- Create: `src-tauri/tests/permission_config.rs`
- Create: `src-tauri/tests/permission_helper.rs`
- Create: `src/components/permissions/PermissionCard.vue`
- Create: `src/components/permissions/QuestionCard.vue`
- Create: `src/components/permissions/PermissionCard.spec.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/components/conversation/ConversationView.vue`

**Interfaces:**
- Consumes: coordinator, invocation builder, task events, and UI runtime state.
- Produces: `PermissionHub::request`, `resolve`, and `clear_task`; `GrantCache`; `TemporaryMcpConfig`; helper mode `run_permission_helper(args)`; Tauri command `resolve_permission`; and permission/question cards.

- [ ] **Step 1: Write failing decision and grant-scope tests**

```rust
#[tokio::test]
async fn unresolved_request_times_out_as_deny() {
    let hub = PermissionHub::with_timeout(Duration::from_millis(20));
    let decision = hub.request(request("r1", "Bash")).await.unwrap();
    assert_eq!(decision, PermissionDecision::Deny { message: "Permission request timed out".into() });
}

#[test]
fn task_grant_never_matches_another_task() {
    let mut grants = GrantCache::default();
    grants.allow("task-a", "Bash(git status *)");
    assert!(grants.matches("task-a", "Bash(git status *)"));
    assert!(!grants.matches("task-b", "Bash(git status *)"));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test permission_hub`

Expected: FAIL because permission types do not exist.

- [ ] **Step 2: Implement in-memory pending requests and safe task grants**

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PermissionDecision {
    AllowOnce { updated_input: serde_json::Value },
    AllowTask { updated_input: serde_json::Value, rule: String },
    Deny { message: String },
}

pub struct PermissionHub {
    pending: tokio::sync::Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>,
    grants: tokio::sync::Mutex<GrantCache>,
    timeout: Duration,
}
```

`AllowTask` is accepted only when the Claude request includes a nonempty explicit permission suggestion. Cache the exact suggestion string under the current task ID. If no suggestion exists, the UI receives `canAllowTask: false`.

- [ ] **Step 3: Write a failing temporary MCP-config test, then implement it**

```rust
#[test]
fn config_uses_current_executable_and_scoped_connection_token() {
    let config = TemporaryMcpConfig::create(exe("Claude Desk"), "127.0.0.1:43123", "token-1", "run-1").unwrap();
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(config.path()).unwrap()).unwrap();
    assert_eq!(json["mcpServers"]["claude_desk_permissions"]["command"], exe("Claude Desk").to_string_lossy());
    assert_eq!(json["mcpServers"]["claude_desk_permissions"]["args"][0], "--permission-helper");
}
```

The file must be created in the app cache directory with user-only permissions where supported, contain no Claude credential, and delete itself in `Drop`.

- [ ] **Step 4: Implement the loopback framed bridge**

Use one JSON object per newline with a maximum frame size of 1 MiB:

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum BridgeFrame {
    Hello { token: String, run_id: String },
    Request { request_id: String, tool_name: String, input: Value, suggestions: Vec<String> },
    Decision { request_id: String, decision: PermissionDecision },
    Shutdown,
}
```

Bind only to `127.0.0.1:0`. Reject the first frame unless token and run ID exactly match; reject additional clients; close the connection when the run ends.

- [ ] **Step 5: Implement the MCP stdio permission helper**

Use `rmcp = { version = "3.0.0", features = ["server", "macros", "transport-io", "schemars"] }`. Expose exactly one tool named `approve` whose input is:

```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct PermissionToolInput {
    pub tool_name: String,
    pub input: serde_json::Map<String, serde_json::Value>,
    pub tool_use_id: Option<String>,
    #[serde(default, alias = "permissionSuggestions")]
    pub permission_suggestions: Vec<String>,
}
```

The tool sends a bridge request and returns one MCP text content item containing exactly one JSON decision:

```json
{"behavior":"allow","updatedInput":{"command":"git status"}}
```

or:

```json
{"behavior":"deny","message":"Denied by user"}
```

Never print diagnostics to stdout in helper mode because stdout belongs to MCP; write diagnostics to stderr.

- [ ] **Step 6: Route executable startup to helper or GUI mode**

```rust
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--permission-helper") {
        claude_desk_lib::permission::run_permission_helper(&args);
        return;
    }
    claude_desk_lib::run();
}
```

Parse helper arguments before Tauri initialization so macOS and Windows can launch the same packaged executable as an MCP child.

- [ ] **Step 7: Replace temporary `dontAsk` with the permission tool invocation**

The final argument suffix is:

```text
--permission-mode default
--mcp-config <absolute-temporary-json-path>
--permission-prompt-tool mcp__claude_desk_permissions__approve
```

Update `ClaudeInvocation` tests to assert `dontAsk` is absent and each value is a separate argument. The coordinator creates the bridge and config before spawning, publishes `permission_requested`, switches status to `awaiting_permission`, and returns to `running` after resolution.

- [ ] **Step 8: Write failing permission-card tests and implement the cards**

```ts
it('hides task-wide allow when no safe suggestion exists', () => {
  const wrapper = mount(PermissionCard, { props: { request: permissionRequest({ suggestions: [] }) } })
  expect(wrapper.find('[data-action="allow-task"]').exists()).toBe(false)
})

it('emits a deny decision', async () => {
  const wrapper = mount(PermissionCard, { props: { request: permissionRequest() } })
  await wrapper.get('[data-action="deny"]').trigger('click')
  expect(wrapper.emitted('resolve')?.[0]).toEqual([{ decision: 'deny' }])
})
```

`QuestionCard` renders each question, its options, multi-select behavior, and optional free text. It resolves `AskUserQuestion` by echoing the original `questions` array and adding an `answers` record whose keys are the full question strings. Single-select values are option labels, multi-select labels are joined with `", "`, and free text is returned verbatim:

```json
{
  "questions": [{
    "question": "Which format?",
    "header": "Format",
    "options": [{ "label": "Summary", "description": "Brief overview" }],
    "multiSelect": false
  }],
  "answers": { "Which format?": "Summary" }
}
```

- [ ] **Step 9: Run permission, frontend, and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test permission_hub
cargo test --manifest-path src-tauri/Cargo.toml --test permission_config
cargo test --manifest-path src-tauri/Cargo.toml --test permission_helper
pnpm test src/components/permissions
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify
```

Expected: all suites pass, and no test invokes the real Claude service.

- [ ] **Step 10: Commit permissions**

```bash
git add src-tauri/Cargo.toml src-tauri/src/permission src-tauri/src/commands/permissions.rs src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/src/claude/invocation.rs src-tauri/src/task/coordinator.rs src-tauri/tests/permission_*.rs src/components/permissions src/services/ipc.ts src/components/conversation/ConversationView.vue
git commit -m "feat: bridge Claude permission prompts"
```

---

### Task 11: Add read-only workspace Git status and Diff

**Files:**
- Create: `src-tauri/src/git/mod.rs`
- Create: `src-tauri/src/git/repository.rs`
- Create: `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/git_repository.rs`
- Create: `src/components/diff/DiffPanel.vue`
- Create: `src/components/diff/FileStatusList.vue`
- Create: `src/components/diff/PatchView.vue`
- Create: `src/components/diff/DiffPanel.spec.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: canonical project paths and validated command boundary.
- Produces: `GitRepository::status`, `diff`, `preview_untracked`; commands `get_git_status`, `get_git_diff`, `preview_untracked_file`; and `GitStatusDto`, `GitFileDto`, `GitDiffDto`.

- [ ] **Step 1: Write failing Git repository tests in temporary directories**

```rust
#[test]
fn reports_staged_unstaged_and_untracked_files() {
    let repo = TempGitRepo::new();
    repo.commit_file("tracked.txt", "one\n");
    repo.write("tracked.txt", "two\n");
    repo.write("new.txt", "new\n");
    let status = GitRepository::open(repo.path()).unwrap().status().unwrap();
    assert!(status.files.iter().any(|file| file.path == "tracked.txt" && file.unstaged));
    assert!(status.files.iter().any(|file| file.path == "new.txt" && file.untracked));
}
```

Add these cases:

```rust
#[test]
fn non_git_directory_has_stable_error() {
    assert_eq!(GitRepository::open(tempdir().unwrap().path()).unwrap_err().code(), "not_git_repository");
}

#[test]
fn traversal_is_rejected_before_git_or_file_read() {
    let repo = TempGitRepo::new();
    assert_eq!(GitRepository::open(repo.path()).unwrap().preview_untracked("../outside").unwrap_err().code(), "path_outside_project");
}

#[test]
fn binary_and_large_diffs_are_bounded() {
    let repo = TempGitRepo::new();
    repo.commit_file("large.txt", "start\n");
    repo.write("large.txt", &"x".repeat(3 * 1024 * 1024));
    repo.write_bytes("image.bin", &[0, 1, 2, 3]);
    let diff = GitRepository::open(repo.path()).unwrap().diff("large.txt", false).unwrap();
    assert!(diff.truncated);
    assert!(diff.patch.len() <= 2 * 1024 * 1024);
    assert!(GitRepository::open(repo.path()).unwrap().preview_untracked("image.bin").unwrap().binary);
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test git_repository`

Expected: FAIL because the Git module does not exist.

- [ ] **Step 2: Implement fixed read-only Git commands**

```rust
fn command(&self, args: &[&str]) -> Result<Output, AppError> {
    Command::new("git")
        .args(["-C", self.root.to_str().ok_or(AppError::invalid_path())?])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(AppError::git)
}
```

Only call fixed variants of `status --porcelain=v2 -z`, `diff --no-ext-diff --binary=false`, and `diff --cached`. File paths go after `--` as independent arguments. Cap returned patch text at 2 MiB and mark `truncated: true`.

- [ ] **Step 3: Add validated Git commands and DTOs**

Reject paths that are absolute, escape the canonical project directory, or resolve through a symlink outside it. For untracked previews, reject files above 1 MiB and bytes containing NUL; return metadata-only for binary content.

- [ ] **Step 4: Write failing DiffPanel tests and implement the panel**

```ts
it('labels the diff as workspace-wide', () => {
  const wrapper = mount(DiffPanel, { props: { status: statusFixture } })
  expect(wrapper.text()).toContain('当前工作目录变更')
  expect(wrapper.text()).not.toContain('此任务的变更')
})
```

Render staged, unstaged, and untracked badges; lazy-load a patch after file selection; display binary and truncation notices; hide the panel action for non-Git projects.

- [ ] **Step 5: Run Git and frontend tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test git_repository
pnpm test src/components/diff
pnpm typecheck
```

Expected: all tests pass.

- [ ] **Step 6: Commit read-only Git support**

```bash
git add src-tauri/src/git src-tauri/src/commands/git.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tests/git_repository.rs src/components/diff src/domain/models.ts src/services/ipc.ts src/App.vue
git commit -m "feat: show workspace git diff"
```

---

### Task 12: Add diagnostics, settings, and bounded raw logs

**Files:**
- Create: `src-tauri/src/diagnostics/mod.rs`
- Create: `src-tauri/src/diagnostics/log_store.rs`
- Create: `src-tauri/src/diagnostics/report.rs`
- Create: `src-tauri/src/commands/diagnostics.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/task/event_sink.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/log_store.rs`
- Create: `src/components/diagnostics/SettingsView.vue`
- Create: `src/components/diagnostics/RawLogDrawer.vue`
- Create: `src/components/diagnostics/SettingsView.spec.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: settings storage, Claude locator, and stderr/unknown stdout lines.
- Produces: `TaskLogStore::append/read/clear`, `build_diagnostic_report`, commands `get_diagnostics`, `save_settings`, `read_task_log`, `clear_task_log`, and Settings/RawLog views.

- [ ] **Step 1: Write failing log rotation and redaction-boundary tests**

```rust
#[test]
fn task_log_never_exceeds_five_mebibytes_after_rotation() {
    let store = TaskLogStore::new(tempdir().unwrap().path().to_owned(), 5 * 1024 * 1024);
    store.append("task-1", &vec![b'x'; 6 * 1024 * 1024]).unwrap();
    assert!(store.read("task-1", 0, usize::MAX).unwrap().bytes.len() <= 5 * 1024 * 1024);
}

#[test]
fn diagnostics_never_include_environment_values() {
    let report = build_diagnostic_report(fixture_context());
    assert!(!report.contains("ANTHROPIC_API_KEY="));
    assert!(report.contains("ANTHROPIC_API_KEY: present"));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test log_store`

Expected: FAIL because diagnostics modules do not exist.

- [ ] **Step 2: Implement per-task bounded append-only logs**

Store logs under the Tauri user log directory as `<task-id>.log`. When an append would exceed 5 MiB, retain the newest bytes beginning at a UTF-8 boundary and replace the file atomically. Validate task IDs as UUIDs before creating a path.

```rust
pub struct LogPage { pub text: String, pub next_offset: u64, pub truncated: bool }
pub fn read(&self, task_id: &str, offset: u64, limit: usize) -> Result<LogPage, AppError>;
```

Cap one read request at 256 KiB.

- [ ] **Step 3: Implement settings and renderer-safe diagnostics**

The report includes app version, OS/architecture, database schema version, Claude resolved path/version, Git version, WebView version when available, and whether selected environment variables are present. It never includes environment values, tokens, full prompts, or file contents.

- [ ] **Step 4: Write failing settings-view tests and implement UI**

```ts
it('saves an absolute custom Claude path and reruns diagnostics', async () => {
  const wrapper = mount(SettingsView, { global: { provide: { ipc: fakeIpc } } })
  await wrapper.get('[aria-label="Claude CLI 路径"]').setValue('/opt/homebrew/bin/claude')
  await wrapper.get('[data-action="save-settings"]').trigger('click')
  expect(fakeIpc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ claudePath: '/opt/homebrew/bin/claude' }))
})
```

Settings includes custom path, re-detect, copy diagnostic report, clear current task log, and links to official Claude installation documentation. External links open only after a user click through the scoped opener plugin.

- [ ] **Step 5: Run diagnostics and frontend tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test log_store
pnpm test src/components/diagnostics
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify
```

Expected: all tests and builds pass.

- [ ] **Step 6: Commit diagnostics**

```bash
git add src-tauri/src/diagnostics src-tauri/src/commands/diagnostics.rs src-tauri/src/commands/mod.rs src-tauri/src/task/event_sink.rs src-tauri/src/lib.rs src-tauri/tests/log_store.rs src/components/diagnostics src/services/ipc.ts src/App.vue
git commit -m "feat: add local diagnostics and logs"
```

---

### Task 13: Guarantee process-tree cleanup and surface workspace conflicts

**Files:**
- Create: `src-tauri/src/process/tree.rs`
- Create: `src-tauri/src/process/unix.rs`
- Create: `src-tauri/src/process/windows.rs`
- Modify: `src-tauri/src/process/runner.rs`
- Modify: `src-tauri/src/process/mod.rs`
- Modify: `src-tauri/src/task/coordinator.rs`
- Modify: `src-tauri/src/domain.rs`
- Modify: `src/domain/events.ts`
- Create: `src-tauri/src/bin/fake_process_tree.rs`
- Create: `src-tauri/tests/process_tree.rs`
- Create: `src-tauri/tests/workspace_conflicts.rs`
- Modify: `src/components/sidebar/TaskRow.vue`
- Modify: `src/components/conversation/ConversationView.vue`

**Interfaces:**
- Consumes: stable `ProcessRunner` and coordinator interfaces.
- Produces: platform `ProcessTreeGuard`, idempotent graceful/forced stop, `workspace_conflict` events, and UI conflict indicators.

- [ ] **Step 1: Write a failing descendant-cleanup integration test**

```rust
#[tokio::test]
async fn cancelling_parent_also_terminates_grandchild() {
    let marker = tempfile::NamedTempFile::new().unwrap();
    let run = spawn_fake_process_tree(marker.path()).await.unwrap();
    run.cancel().await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(!grandchild_is_alive(marker.path()));
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test process_tree`

Expected: FAIL because basic `child.kill()` can leave descendants.

- [ ] **Step 2: Implement Unix process-group cleanup**

On macOS call `setsid()` in `CommandExt::pre_exec` before spawn. Store the process-group ID, send `SIGTERM`, wait up to two seconds, then send `SIGKILL`. Restrict this code to Unix targets.

```rust
#[cfg(unix)]
pub fn terminate_group(pid: u32, signal: nix::sys::signal::Signal) -> Result<(), AppError> {
    nix::sys::signal::killpg(nix::unistd::Pid::from_raw(pid as i32), signal)
        .map_err(AppError::process)
}
```

- [ ] **Step 3: Implement Windows Job Object cleanup**

Create a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assign the spawned Claude process before processing output, and close the Job handle on cancellation or application shutdown. Use the `windows` crate behind `cfg(windows)`; encapsulate all unsafe handle operations in `windows.rs` and implement `Drop`.

```rust
#[async_trait::async_trait]
pub trait ProcessTreeGuard: Send {
    async fn terminate(&mut self, grace: Duration) -> Result<(), AppError>;
}
```

The Windows CI job in Task 15 must compile and execute its process-tree test.

- [ ] **Step 4: Write failing workspace-conflict tests**

```rust
#[tokio::test]
async fn mutating_tool_in_second_task_emits_conflict_for_shared_project() {
    let coordinator = coordinator_with_two_tasks_same_project();
    coordinator.note_tool_started("task-a", "Write").await.unwrap();
    coordinator.note_tool_started("task-b", "Edit").await.unwrap();
    assert!(coordinator.recorded_events().iter().any(|event| matches!(event.payload, TaskEventPayload::WorkspaceConflict { .. })));
}
```

Treat `Edit`, `Write`, `NotebookEdit`, and `Bash` as potentially mutating. Clear the warning when fewer than two potentially mutating tasks remain active for that project.

- [ ] **Step 5: Implement conflict indicators in Sidebar and task header**

Show an amber icon and the exact copy: `多个任务正在修改同一工作目录，文件可能互相覆盖。` Do not block either run.

- [ ] **Step 6: Run platform-available cleanup, conflict, and full tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test process_tree
cargo test --manifest-path src-tauri/Cargo.toml --test workspace_conflicts
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify
```

Expected on macOS: Unix cleanup and all portable tests pass; Windows-specific code compiles later on the Windows CI runner.

- [ ] **Step 7: Commit cleanup and conflict handling**

```bash
git add src-tauri/Cargo.toml src-tauri/src/process src-tauri/src/task/coordinator.rs src-tauri/src/domain.rs src/domain/events.ts src-tauri/src/bin/fake_process_tree.rs src-tauri/tests/process_tree.rs src-tauri/tests/workspace_conflicts.rs src/components/sidebar/TaskRow.vue src/components/conversation/ConversationView.vue
git commit -m "feat: clean process trees and warn on conflicts"
```

---

### Task 14: Harden the desktop boundary and finish the visual system

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/projects.rs`
- Modify: `src-tauri/src/commands/tasks.rs`
- Modify: `src-tauri/src/commands/events.rs`
- Modify: `src-tauri/src/commands/permissions.rs`
- Modify: `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/commands/diagnostics.rs`
- Modify: `src-tauri/src/error.rs`
- Create: `src-tauri/tests/command_validation.rs`
- Create: `src/components/common/InlineError.vue`
- Create: `src/components/common/EmptyState.vue`
- Create: `src/components/common/StatusPill.vue`
- Create: `src/components/common/common.spec.ts`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/app.css`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: every renderer and command surface from Tasks 1–13.
- Produces: final CSP/capability policy, shared accessible status components, keyboard navigation, collapsible/resizable Sidebar, and hardened use of the existing `CommandError` presentation.

- [ ] **Step 1: Write failing command-boundary tests**

```rust
#[test]
fn rejects_unknown_task_and_paths_outside_the_project() {
    let state = fixture_state();
    assert_eq!(state.validate_task("missing").unwrap_err().code(), "task_not_found");
    assert_eq!(state.validate_project_file("project-1", "../secret").unwrap_err().code(), "path_outside_project");
}
```

Add these cases to the same test target:

```rust
assert_eq!(validate_prompt("   ").unwrap_err().code(), "prompt_empty");
assert_eq!(validate_prompt(&"x".repeat(1_048_577)).unwrap_err().code(), "prompt_too_large");
assert_eq!(validate_uuid("not-a-uuid").unwrap_err().code(), "invalid_id");
assert_eq!(state.add_project(path_to_regular_file()).unwrap_err().code(), "project_not_directory");
assert_eq!(state.validate_project_file("project-1", symlink_to_outside()).unwrap_err().code(), "path_outside_project");
assert_eq!(validate_log_limit(262_145).unwrap_err().code(), "log_limit_too_large");
assert_eq!(state.resolve_permission("missing-request", PermissionDecisionKind::Deny).unwrap_err().code(), "permission_request_not_found");
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test command_validation`

Expected: at least one test fails until every adapter uses centralized validators.

- [ ] **Step 2: Centralize validation and safe error serialization**

```rust
impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code().to_owned(),
            message: error.safe_message().to_owned(),
            recoverable: error.is_recoverable(),
            correlation_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}
```

Do not serialize Rust backtraces, SQL statements, environment values, tokens, or absolute paths unrelated to the selected project. Log internal causes locally with a correlation ID and show that ID in diagnostics.

- [ ] **Step 3: Lock Tauri capabilities and CSP**

Set CSP to allow only `default-src 'self'`, local images/data images needed by Markdown, and Tauri IPC. Do not enable remote scripts, `eval`, arbitrary filesystem scopes, shell execution, clipboard reads, or updater permissions. Limit opener URLs to `https://code.claude.com/*` and `https://v2.tauri.app/*`.

- [ ] **Step 4: Write failing accessibility/component tests and implement shared UI**

```ts
it('exposes task status without relying on color alone', () => {
  const wrapper = mount(StatusPill, { props: { status: 'awaiting_permission' } })
  expect(wrapper.attributes('aria-label')).toBe('状态：等待审批')
  expect(wrapper.text()).toContain('等待审批')
})
```

Implement focus-visible rings, `aria-live="polite"` for status text, `aria-live="assertive"` for errors, 44-pixel primary targets, and keyboard commands: `Cmd/Ctrl+N` new task, `Cmd/Ctrl+Enter` send, `Escape` close auxiliary panel.

- [ ] **Step 5: Finish the approved theme and responsive layout**

Use the confirmed black, charcoal, warm-white, and orange tokens. Persist Sidebar width in settings with a clamp of 220–420 pixels; collapse below a 900-pixel window width. Tool cards and Diff panels must use borders and labels in addition to color.

- [ ] **Step 6: Run security, accessibility, type, and build verification**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test command_validation
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm typecheck
pnpm build
```

Expected: every command-validation case passes and all frontend/Rust checks exit 0.

- [ ] **Step 7: Commit hardening and polish**

```bash
git add src-tauri/capabilities/default.json src-tauri/tauri.conf.json src-tauri/src/commands src-tauri/tests/command_validation.rs src/components/common src/styles src/App.vue
git commit -m "feat: harden and polish desktop shell"
```

---

### Task 15: Add end-to-end coverage, installer builds, and operator documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/workspace.spec.ts`
- Create: `src/services/fakeIpc.ts`
- Modify: `src/services/ipc.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `.github/workflows/build-installers.yml`
- Create: `docs/testing/platform-smoke.md`
- Create: `README.md`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: the completed desktop application and fake CLI.
- Produces: `pnpm test:e2e`, native CI artifacts `claude-desk-macos-arm64` and `claude-desk-windows-x64`, exact local build commands, and platform acceptance evidence template.

- [ ] **Step 1: Write a failing browser-level core-flow test**

```ts
test('adds a project, runs a task, resolves permission, and restores history', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '添加项目' }).click()
  await expect(page.getByText('Demo Project')).toBeVisible()
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('发送给 Claude').fill('Create hello.txt')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('Write')).toBeVisible()
  await page.getByRole('button', { name: '允许一次' }).click()
  await expect(page.getByText('完成')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Create hello.txt')).toBeVisible()
})
```

Use a development-only IPC adapter selected by `VITE_FAKE_IPC=1`; it replays the same versioned fixture events as the Rust fake CLI. Production builds must tree-shake this adapter and reject `VITE_FAKE_IPC=1` in Tauri build scripts.

- [ ] **Step 2: Configure and pass Playwright tests**

```ts
// playwright.config.ts
export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    env: { ...process.env, VITE_FAKE_IPC: '1' },
  },
  use: { baseURL: 'http://127.0.0.1:1420' },
})
```

Run `pnpm add -D @playwright/test@1.63.0`, add `"test:e2e": "playwright test"` to `package.json`, run `pnpm exec playwright install chromium`, and then run `pnpm test:e2e`.

Expected: the core flow and separate failure/restart tests pass.

- [ ] **Step 3: Configure platform bundles**

In `tauri.conf.json`, set icons, `bundle.active: true`, macOS `minimumSystemVersion: "13.0"`, macOS `signingIdentity: "-"`, and Windows NSIS `installMode: "currentUser"`. Do not configure an updater or release endpoint.

Local build commands are:

```bash
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

Run each command only on its target OS.

- [ ] **Step 4: Add the test-and-build CI matrix without releases**

```yaml
name: build-installers
on:
  workflow_dispatch:
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14
            target: aarch64-apple-darwin
            bundles: app,dmg
            artifact: claude-desk-macos-arm64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            bundles: nsis
            artifact: claude-desk-windows-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.8.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: '${{ matrix.target }}' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: pnpm tauri build --target ${{ matrix.target }} --bundles ${{ matrix.bundles }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: src-tauri/target/${{ matrix.target }}/release/bundle/**
```

Add Playwright installation and `pnpm test:e2e` before the bundle command. Never add `tauri-action` release creation or a `release` event.

- [ ] **Step 5: Write the exact platform smoke checklist**

The checklist records app commit, app version, OS version, Claude version, installer filename, and pass/fail evidence for:

1. install and first launch;
2. CLI auto-detection and custom path;
3. real read-only prompt;
4. Write or Edit approval allow-once and deny;
5. Bash approval;
6. stop during streaming and confirm no child remains;
7. restart and resume the exact task;
8. workspace Diff and non-Git behavior;
9. two parallel tasks and conflict warning;
10. uninstall while project files and Claude credentials remain untouched.

- [ ] **Step 6: Document private installation and warnings**

`README.md` must include prerequisites, Rust/Node/pnpm setup, Claude login performed in an external terminal, development commands, test commands, local bundle commands, GitHub artifact download, macOS Privacy & Security approval, Windows SmartScreen warning, data locations, log clearing, and the private-use/authentication boundary from the spec.

- [ ] **Step 7: Run the final local verification suite**

Run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
git status --short
```

Expected on the current macOS Apple Silicon machine: all checks exit 0, `.app` and `.dmg` exist below `src-tauri/target/aarch64-apple-darwin/release/bundle/`, and `git status --short` lists only the Task 15 source/documentation files about to be committed. Windows completion is not claimed until the Windows CI job passes and its NSIS artifact completes the Windows smoke checklist.

- [ ] **Step 8: Commit automation and documentation**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/e2e .github/workflows/build-installers.yml docs/testing/platform-smoke.md README.md src-tauri/tauri.conf.json
git commit -m "build: produce private desktop installers"
```

- [ ] **Step 9: Verify the final commit and clean source tree**

Run:

```bash
git status --short
git log -1 --oneline
```

Expected: `git status --short` is empty and the latest commit subject is `build: produce private desktop installers`. Generated installer files stay ignored and do not enter Git.

## Final Review Gate

Before declaring the MVP complete, compare every item in `docs/superpowers/specs/2026-09-06-claude-desk-design.md` section 17 against fresh command output and both platform smoke-check records. A macOS build alone is partial completion; the Windows installer and Windows process-tree behavior require evidence from a Windows runner and Windows machine or VM.
