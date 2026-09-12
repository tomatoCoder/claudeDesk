# Claude Desk 斜杠命令与 Skill 对齐实施计划（Task 2~4 更新版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Rust 目录 IPC、前端 `/` 补全菜单（含 Skill）、`/model` `/config` `/permissions` 原生命令路由，让输入 `/` 的体验与 Claude CLI 一致。

**Architecture:** Bridge 已通过 Agent SDK `supportedCommands()`/`supportedModels()` 提供真实目录（Task 1 已完成）。Rust 层新增 `list_slash_commands` IPC 与进程内缓存、任务级模型/权限覆盖（优先于应用级设置）、`local_command_output`/`commands_changed` 事件映射。Vue 层按项目缓存目录，`ComposerBox` 在首 token 为 `/` 时弹出 listbox 补全菜单，仅裸 `/model` `/config` `/permissions` 被拦截到原生界面，其余命令（含全部 Skill）逐字节原样发送。

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri 2, Rust, Claude Agent SDK。

**Spec:** `docs/superpowers/specs/2026-09-10-claude-desk-slash-commands-design.md`（母设计）+ `docs/superpowers/specs/2026-09-12-slash-commands-completion-design.md`（本次增量）

## Global Constraints

- 命令数据唯一来源是当前 CLI 通过 Agent SDK `supportedCommands()` 返回的结果；不扫描 Skill 目录、不硬编码兜底目录。
- 任务级覆盖优先于应用级设置；覆盖值为空表示「跟随应用设置」。
- 任务级权限模式只接受 `default | acceptEdits | plan | dontAsk`，永不包含 `bypassPermissions`/`auto`。
- Skill 和普通命令文本经 `send_turn` 原样传递，前端不改写别名或参数。
- 用户参数不经 shell，只走既有 JSON 协议。
- 普通聊天不依赖目录加载成功。
- **不创建 Git 提交**（用户明确要求，所有改动保留在工作区）。

---

### Task 1: Bridge 命令发现与本地命令事件 ✅ 已完成

已随 commit 53c1e69 落地：`bridge/src/commands.ts`（`discoverCommandCatalog`）、`commands.list` 协议、`local_command_output`/`commands.changed` 归一化、`run.start` 的 `model`/`modelOverride`/`permissionMode` 字段。**本计划不再改动 bridge/src 下任何文件。**

---

### Task 2: Rust 事件映射、目录解析与任务级偏好

**Files:**
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/bridge/mod.rs`
- Modify: `src-tauri/src/storage/migrations.rs`
- Modify: `src-tauri/src/storage/repository.rs`
- Modify: `src-tauri/src/task/coordinator.rs`
- Create: `src-tauri/src/commands/slash_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/bridge_event_mapping.rs`
- Create: `src-tauri/tests/slash_commands.rs`

**Interfaces:**
- Consumes: `bridge::request`、`claude::diagnose`、`Storage`、Bridge 协议 v1 `commands.list`/`commands.result`。
- Produces: `TaskEventPayload::LocalCommandOutput`、`TaskPermissionMode`、`SlashCommandCatalogDto`、`SlashCommandsChanged`、`parse_slash_catalog`、`TaskDto.model_override/permission_mode_override`、IPC `list_slash_commands`/`set_task_model`/`set_task_permission_mode`。

- [ ] **Step 1: 写失败的 Rust 测试**

`src-tauri/tests/bridge_event_mapping.rs` 追加：

```rust
#[test]
fn maps_local_command_output_to_a_timeline_event() {
    let value = serde_json::json!({
        "v": 1, "type": "local_command_output", "requestId": "r", "runId": "run-1",
        "sequence": 3, "content": "Available commands"
    });
    assert!(matches!(
        event_to_payload(&value).unwrap(),
        Some(TaskEventPayload::LocalCommandOutput { content }) if content == "Available commands"
    ));
}

#[test]
fn local_command_output_without_content_is_rejected() {
    let value = serde_json::json!({
        "v": 1, "type": "local_command_output", "requestId": "r", "runId": "run-1", "sequence": 3
    });
    assert!(event_to_payload(&value).is_err());
}
```

新建 `src-tauri/tests/slash_commands.rs`：

```rust
use claude_desk_lib::{
    bridge::parse_slash_catalog,
    domain::{SlashCommandCatalogDto, TaskPermissionMode},
    storage::Storage,
};

#[test]
fn parses_catalog_and_skips_malformed_entries() {
    let value = serde_json::json!({
        "commands": [
            { "name": "review", "description": "Review code", "argumentHint": "<path>", "aliases": ["rv"] },
            { "name": "  ", "description": "empty name" },
            { "description": "missing name" },
        ],
        "models": [
            { "value": "sonnet", "displayName": "Sonnet", "description": "Balanced" },
            { "value": "" },
        ],
    });
    let catalog = parse_slash_catalog(&value).unwrap();
    assert_eq!(catalog.commands.len(), 1);
    assert_eq!(catalog.commands[0].name, "review");
    assert_eq!(catalog.commands[0].aliases, vec!["rv".to_string()]);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].resolved_model, None);
}

#[test]
fn catalog_without_commands_or_models_arrays_is_invalid() {
    assert!(parse_slash_catalog(&serde_json::json!({})).is_err());
}

#[test]
fn task_permission_mode_accepts_only_safe_modes() {
    assert_eq!(TaskPermissionMode::parse("default"), Some(TaskPermissionMode::Default));
    assert_eq!(TaskPermissionMode::parse("acceptEdits"), Some(TaskPermissionMode::AcceptEdits));
    assert_eq!(TaskPermissionMode::parse("plan"), Some(TaskPermissionMode::Plan));
    assert_eq!(TaskPermissionMode::parse("dontAsk"), Some(TaskPermissionMode::DontAsk));
    assert_eq!(TaskPermissionMode::parse("bypassPermissions"), None);
    assert_eq!(TaskPermissionMode::parse("auto"), None);
    assert_eq!(TaskPermissionMode::parse(""), None);
}

#[test]
fn task_overrides_roundtrip_and_clear_through_storage() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(temp.path().join("app.db")).unwrap();
    let project = storage.create_or_touch_project("demo", temp.path()).unwrap();
    let task = storage.create_task(&project.id, "新任务").unwrap();

    let updated = storage
        .set_task_model_override(&task.id, Some("sonnet"))
        .unwrap();
    assert_eq!(updated.model_override.as_deref(), Some("sonnet"));
    assert_eq!(updated.permission_mode_override, None);

    let updated = storage
        .set_task_permission_mode_override(&task.id, Some(TaskPermissionMode::Plan))
        .unwrap();
    assert_eq!(updated.permission_mode_override, Some(TaskPermissionMode::Plan));

    let updated = storage.set_task_model_override(&task.id, None).unwrap();
    assert_eq!(updated.model_override, None);
    assert_eq!(updated.permission_mode_override, Some(TaskPermissionMode::Plan));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test bridge_event_mapping --test slash_commands`
Expected: FAIL —— `LocalCommandOutput`/`TaskPermissionMode`/`parse_slash_catalog`/`set_task_model_override` 未定义。

- [ ] **Step 3: domain.rs 新增类型与字段**

在 `AppPermissionMode` 定义之后追加：

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskPermissionMode {
    Default,
    AcceptEdits,
    Plan,
    DontAsk,
}

impl TaskPermissionMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "default" => Some(Self::Default),
            "acceptEdits" => Some(Self::AcceptEdits),
            "plan" => Some(Self::Plan),
            "dontAsk" => Some(Self::DontAsk),
            _ => None,
        }
    }

    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AcceptEdits => "acceptEdits",
            Self::Plan => "plan",
            Self::DontAsk => "dontAsk",
        }
    }
}
```

`TaskEventPayload` 枚举 `Error` 变体之前追加：

```rust
    LocalCommandOutput {
        content: String,
    },
```

`TaskEventPayload::kind()` 的 `Error` 分支前追加：

```rust
            Self::LocalCommandOutput { .. } => "local_command_output",
```

`TaskDto` 在 `claude_session_id` 之后追加两个字段（camelCase 序列化为 `modelOverride`/`permissionModeOverride`）：

```rust
    pub model_override: Option<String>,
    pub permission_mode_override: Option<TaskPermissionMode>,
```

文件末尾追加 DTO：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandDto {
    pub name: String,
    pub description: String,
    pub argument_hint: String,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfoDto {
    pub value: String,
    pub display_name: String,
    pub description: String,
    pub resolved_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandCatalogDto {
    pub commands: Vec<SlashCommandDto>,
    pub models: Vec<ModelInfoDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandsChanged {
    pub project_id: String,
    pub catalog: SlashCommandCatalogDto,
}
```

- [ ] **Step 4: bridge/mod.rs 事件映射与目录解析**

`event_to_payload` 的 match 中 `"run.result"` 分支之前追加：

```rust
        "local_command_output" => Some(TaskEventPayload::LocalCommandOutput {
            content: text("content")?,
        }),
```

文件末尾追加（复用已有的 `AppError`；`use` 需补充 `crate::domain::{ModelInfoDto, SlashCommandCatalogDto, SlashCommandDto}`）：

```rust
pub fn parse_slash_catalog(value: &Value) -> Result<SlashCommandCatalogDto, AppError> {
    let commands_json = value
        .get("commands")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("bridge_event_invalid", "命令目录缺少 commands 数组", true))?;
    let models_json = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("bridge_event_invalid", "命令目录缺少 models 数组", true))?;
    let mut commands = Vec::new();
    for command in commands_json {
        let Some(name) = command.get("name").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        commands.push(SlashCommandDto {
            name: name.into(),
            description: command.get("description").and_then(Value::as_str).unwrap_or_default().into(),
            argument_hint: command.get("argumentHint").and_then(Value::as_str).unwrap_or_default().into(),
            aliases: command
                .get("aliases")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect())
                .unwrap_or_default(),
        });
    }
    let mut models = Vec::new();
    for model in models_json {
        let Some(model_value) = model.get("value").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if model_value.is_empty() {
            continue;
        }
        models.push(ModelInfoDto {
            value: model_value.into(),
            display_name: model.get("displayName").and_then(Value::as_str).unwrap_or_default().into(),
            description: model.get("description").and_then(Value::as_str).unwrap_or_default().into(),
            resolved_model: model.get("resolvedModel").and_then(Value::as_str).map(str::to_owned),
        });
    }
    Ok(SlashCommandCatalogDto { commands, models })
}
```

- [ ] **Step 5: storage 迁移与 repository**

`migrations.rs` 改为（fresh 库建表即含新列；旧库 user_version==1 时补列）：

```rust
pub fn migrate(connection: &Connection) -> Result<(), AppError> {
    let previous_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          canonical_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          claude_session_id TEXT,
          status TEXT NOT NULL,
          model_override TEXT,
          permission_mode_override TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(task_id, run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS events_task_order ON events(task_id, id);
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )?;
    if previous_version == 1 {
        connection.execute_batch(
            "ALTER TABLE tasks ADD COLUMN model_override TEXT;
             ALTER TABLE tasks ADD COLUMN permission_mode_override TEXT;",
        )?;
    }
    connection.execute_batch("PRAGMA user_version = 2;")?;
    Ok(())
}
```

`repository.rs`：

1. `use` 的 domain 导入追加 `TaskPermissionMode`。
2. 新增常量并替换 4 处任务 SELECT（`get_task`/`list_tasks`/`list_project_tasks`）：

```rust
const TASK_COLUMNS: &str = "id,project_id,title,claude_session_id,status,model_override,permission_mode_override,created_at,updated_at";
```

`get_task` 的 SQL 改为 `format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id=?1")`，其余同理（保留原排序与参数）。

3. `task_from_row` 改为：

```rust
fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskDto> {
    let status: String = row.get(4)?;
    let permission_mode_override: Option<String> = row.get(6)?;
    Ok(TaskDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        claude_session_id: row.get(3)?,
        status: TaskStatus::parse(&status),
        model_override: row.get(5)?,
        permission_mode_override: permission_mode_override.as_deref().and_then(TaskPermissionMode::parse),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
```

4. `rename_task` 方法后追加：

```rust
    pub fn set_task_model_override(&self, id: &str, model: Option<&str>) -> Result<TaskDto, AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET model_override=?1, updated_at=?2 WHERE id=?3",
            params![model, chrono::Utc::now().to_rfc3339(), id],
        )?;
        self.get_task(id)
    }

    pub fn set_task_permission_mode_override(
        &self,
        id: &str,
        mode: Option<TaskPermissionMode>,
    ) -> Result<TaskDto, AppError> {
        self.connection.lock().execute(
            "UPDATE tasks SET permission_mode_override=?1, updated_at=?2 WHERE id=?3",
            params![mode.map(TaskPermissionMode::as_str), chrono::Utc::now().to_rfc3339(), id],
        )?;
        self.get_task(id)
    }
```

- [ ] **Step 6: 运行 Step 1 的测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test bridge_event_mapping --test slash_commands`
Expected: PASS（coordinator 尚未编译通过的话先完成 Step 7 再跑）。

- [ ] **Step 7: coordinator 缓存、run.start 覆盖与 commands.changed**

`coordinator.rs`：

1. domain 导入追加 `SlashCommandCatalogDto, SlashCommandsChanged, TaskDto, TaskPermissionMode`。
2. `CoordinatorState` 追加字段：

```rust
struct CoordinatorState {
    running: HashMap<String, RunningTask>,
    queued_turns: TurnQueue,
    slash_catalogs: HashMap<String, SlashCommandCatalogDto>,
}
```

3. `run()` 中 `let start = build_run_start(...)` 一行改为（任务级覆盖 > 应用级）：

```rust
        let managed = self.settings.load()?.values;
        let app_permission_mode = self.storage.load_settings()?.permission_mode;
        let task = self.storage.get_task(&task_id)?;
        let start = build_run_start(
            &run_id,
            &executable,
            &cwd,
            &prompt,
            session_id.as_deref(),
            &managed.model,
            app_permission_mode,
            task.model_override.as_deref(),
            task.permission_mode_override,
        );
```

4. `build_run_start` 签名与尾部改为：

```rust
#[allow(clippy::too_many_arguments)]
fn build_run_start(
    run_id: &str,
    executable: &std::path::Path,
    cwd: &std::path::Path,
    prompt: &str,
    session_id: Option<&str>,
    model: &str,
    permission_mode: AppPermissionMode,
    model_override: Option<&str>,
    permission_mode_override: Option<TaskPermissionMode>,
) -> Value {
    let mut start = json!({
        "v": 1,
        "type": "run.start",
        "requestId": uuid::Uuid::new_v4().to_string(),
        "runId": run_id,
        "claudePath": executable,
        "cwd": cwd,
        "prompt": prompt,
    });
    if let Some(session_id) = session_id {
        start["sessionId"] = Value::String(session_id.into());
    } else if !model.trim().is_empty() {
        start["model"] = Value::String(model.into());
    }
    if let Some(model_override) = model_override.filter(|value| !value.trim().is_empty()) {
        start["modelOverride"] = Value::String(model_override.into());
    }
    if let Some(mode) = permission_mode_override {
        start["permissionMode"] = Value::String(mode.as_str().into());
    } else if let Some(mode) = bridge_permission_mode(permission_mode) {
        start["permissionMode"] = Value::String(mode.into());
    }
    start
}
```

5. `handle_worker_event` 的 match 中 `"run.status"` 分支之前追加：

```rust
            "commands.changed" => {
                let catalog = bridge::parse_slash_catalog(&value)?;
                let project_id = self.storage.get_task(task_id)?.project_id;
                self.state.lock().slash_catalogs.insert(project_id.clone(), catalog.clone());
                app.emit("slash-commands-changed", &SlashCommandsChanged { project_id, catalog })
                    .map_err(|error| AppError::new("event_emit_failed", error.to_string(), true))?;
            }
```

注意：`commands.changed` 不进时间线、不持久化，只更新缓存并通知前端（替换语义）。

6. `cancel` 方法之前追加公开方法：

```rust
    pub async fn list_slash_commands(
        &self,
        app: &AppHandle,
        project_id: &str,
    ) -> Result<SlashCommandCatalogDto, AppError> {
        if let Some(catalog) = self.state.lock().slash_catalogs.get(project_id) {
            return Ok(catalog.clone());
        }
        let project = self.storage.get_project(project_id)?;
        let settings = self.storage.load_settings()?;
        let cli = diagnose(settings.claude_path.as_deref())?;
        if cli.status != CliDiagnosticStatus::Ready {
            return Err(AppError::new("cli_not_ready", cli.message, true));
        }
        let executable = cli.path.ok_or_else(|| AppError::new("cli_not_found", "未找到 Claude Code CLI", true))?;
        let request = json!({
            "v": 1,
            "type": "commands.list",
            "requestId": uuid::Uuid::new_v4().to_string(),
            "claudePath": executable,
            "cwd": project.path,
        });
        let response = bridge::request(app, &request).await?;
        let catalog = bridge::parse_slash_catalog(&response)?;
        self.state.lock().slash_catalogs.insert(project_id.into(), catalog.clone());
        Ok(catalog)
    }

    pub async fn set_task_model(&self, app: &AppHandle, task_id: &str, model: &str) -> Result<TaskDto, AppError> {
        let task = self.storage.get_task(task_id)?;
        let trimmed = model.trim();
        let override_value = if trimmed.is_empty() {
            None
        } else {
            let catalog = self.list_slash_commands(app, &task.project_id).await?;
            if !catalog.models.iter().any(|item| item.value == trimmed) {
                return Err(AppError::new("model_not_available", "所选模型不在当前项目可用模型列表中", true));
            }
            Some(trimmed)
        };
        self.storage.set_task_model_override(task_id, override_value)
    }

    pub fn set_task_permission_mode(&self, task_id: &str, mode: &str) -> Result<TaskDto, AppError> {
        let trimmed = mode.trim();
        let override_value = if trimmed.is_empty() {
            None
        } else {
            Some(TaskPermissionMode::parse(trimmed)
                .ok_or_else(|| AppError::new("invalid_permission_mode", "不支持的任务权限模式", true))?)
        };
        self.storage.set_task_permission_mode_override(task_id, override_value)
    }
```

（`set_task_model` 空字符串表示清除覆盖，此时不触发目录发现。）

- [ ] **Step 8: Tauri 命令注册**

新建 `src-tauri/src/commands/slash_commands.rs`：

```rust
use crate::{
    commands::AppState,
    domain::{SlashCommandCatalogDto, TaskDto},
    error::AppError,
};
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "camelCase")]
pub async fn list_slash_commands(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SlashCommandCatalogDto, AppError> {
    super::validate_id(&project_id)?;
    state.coordinator.list_slash_commands(&app, &project_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_task_model(
    task_id: String,
    model: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.set_task_model(&app, &task_id, &model).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_task_permission_mode(
    task_id: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppError> {
    super::validate_id(&task_id)?;
    state.coordinator.set_task_permission_mode(&task_id, &mode)
}
```

`commands/mod.rs` 模块声明追加 `pub mod slash_commands;`。

`lib.rs` 的 `generate_handler!` 列表追加三项：

```rust
            commands::slash_commands::list_slash_commands,
            commands::slash_commands::set_task_model,
            commands::slash_commands::set_task_permission_mode,
```

- [ ] **Step 9: Rust 全量验证**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS（含既有 `app_settings`、`bridge_protocol` 等）。

---

### Task 3: 前端目录服务与 `/` 补全菜单

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/services/i18n.ts`
- Create: `src/services/slashCommands.ts`
- Create: `src/services/slashCommands.spec.ts`
- Create: `src/components/conversation/SlashCommandMenu.vue`
- Create: `src/components/conversation/SlashCommandMenu.spec.ts`
- Modify: `src/components/conversation/ComposerBox.vue`
- Create: `src/components/conversation/ComposerBox.spec.ts`
- Modify: `src/components/conversation/ConversationView.vue`
- Modify: `src/components/conversation/ConversationView.spec.ts`

**Interfaces:**
- Consumes: `ipc.listSlashCommands(projectId)`。
- Produces: `loadSlashCommandCatalog`/`invalidateSlashCommandCatalog`/`filterSlashCommands`、`SlashCommandMenu`、ComposerBox 补全键盘行为、`local_command_output` 时间线渲染。

- [ ] **Step 1: 写失败的前端测试**

新建 `src/services/slashCommands.spec.ts`（vi.mock 掉 ipc）：

```ts
vi.mock('./ipc', () => ({
  ipc: { listSlashCommands: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}))
import { describe, expect, it, vi } from 'vitest'
import { filterSlashCommands, invalidateSlashCommandCatalog, loadSlashCommandCatalog } from './slashCommands'
import { ipc } from './ipc'

const commands = [
  { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] },
  { name: 'permissions', description: 'Manage permissions', argumentHint: '', aliases: [] },
  { name: 'inspect', description: '', argumentHint: '', aliases: ['review-all'] },
]

describe('slashCommands', () => {
  it('同一项目的并发加载共享同一个 Promise，失败后可重试', async () => {
    const mock = vi.mocked(ipc.listSlashCommands).mockResolvedValueOnce({ commands: [], models: [] })
    const first = loadSlashCommandCatalog('p1')
    expect(loadSlashCommandCatalog('p1')).toBe(first)
    await first
    expect(mock).toHaveBeenCalledTimes(1)

    vi.mocked(ipc.listSlashCommands).mockRejectedValueOnce(new Error('boom'))
    await expect(loadSlashCommandCatalog('p2')).rejects.toThrow('boom')
    vi.mocked(ipc.listSlashCommands).mockResolvedValueOnce({ commands: [], models: [] })
    await expect(loadSlashCommandCatalog('p2')).resolves.toBeDefined()
  })

  it('invalidate 后重新发起真实请求', async () => {
    const mock = vi.mocked(ipc.listSlashCommands).mockResolvedValue({ commands: [], models: [] })
    await loadSlashCommandCatalog('p3')
    invalidateSlashCommandCatalog('p3')
    await loadSlashCommandCatalog('p3')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('名称前缀优先于别名前缀，忽略大小写', () => {
    const ranked = filterSlashCommands(commands, '/RE')
    expect(ranked.map((item) => item.command.name)).toEqual(['review', 'inspect'])
    expect(ranked[1].matchedAlias).toBe('review-all')
  })

  it('空查询返回全部命令', () => {
    expect(filterSlashCommands(commands, '/')).toHaveLength(3)
  })
})
```

新建 `src/components/conversation/SlashCommandMenu.spec.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SlashCommandMenu from './SlashCommandMenu.vue'

const items = [
  { command: { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }, matchedAlias: null },
  { command: { name: 'inspect', description: '', argumentHint: '', aliases: [] }, matchedAlias: null },
]

describe('SlashCommandMenu', () => {
  it('渲染 listbox 语义与命令信息', () => {
    const wrapper = mount(SlashCommandMenu, { props: { items, activeIndex: 1, loading: false, error: '' } })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('/review')
    expect(options[0].text()).toContain('Review code')
    expect(options[0].text()).toContain('<path>')
    expect(options[1].attributes('aria-selected')).toBe('true')
  })

  it('点击选项时 emit 对应下标', async () => {
    const wrapper = mount(SlashCommandMenu, { props: { items, activeIndex: 0, loading: false, error: '' } })
    await wrapper.findAll('[role="option"]')[1].trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([1])
  })

  it('展示加载与错误状态', () => {
    const loading = mount(SlashCommandMenu, { props: { items: [], activeIndex: 0, loading: true, error: '' } })
    expect(loading.text()).toContain('正在从 CLI 加载命令')
    const error = mount(SlashCommandMenu, { props: { items: [], activeIndex: 0, loading: false, error: 'boom' } })
    expect(error.text()).toContain('boom')
    expect(error.find('button').exists()).toBe(true)
  })
})
```

新建 `src/components/conversation/ComposerBox.spec.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ComposerBox from './ComposerBox.vue'

const commands = [
  { name: 'review', description: 'Review code', argumentHint: '<path>', aliases: [] },
  { name: 'permissions', description: 'Manage permissions', argumentHint: '', aliases: [] },
]

function mountComposer() {
  return mount(ComposerBox, {
    props: {
      status: 'idle' as const,
      queuedTurns: [],
      commands,
      submit: vi.fn().mockResolvedValue(undefined),
      adjust: vi.fn().mockResolvedValue(undefined),
      sendNow: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
  })
}

async function typeSlash(wrapper: ReturnType<typeof mountComposer>) {
  const textarea = wrapper.find('textarea')
  await textarea.setValue('/')
  await textarea.trigger('input')
  await textarea.trigger('click')
  return textarea
}

describe('ComposerBox slash menu', () => {
  it('输入 / 打开菜单，Enter 填入命令但不发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    await textarea.trigger('keydown', { key: 'Enter' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/review ')
    expect(wrapper.props('submit')).not.toHaveBeenCalled()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('ArrowDown 移动选中项，Tab 填入', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'ArrowDown' })
    await textarea.trigger('keydown', { key: 'Tab' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/permissions ')
  })

  it('Escape 关闭菜单，之后 Enter 恢复发送行为', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.props('submit')).toHaveBeenCalledWith('/')
  })

  it('Cmd+Enter 在菜单打开时仍是换行而不是发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(wrapper.props('submit')).not.toHaveBeenCalled()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/\n')
  })

  it('无匹配项时 Enter 直接按原文发送', async () => {
    const wrapper = mountComposer()
    const textarea = await typeSlash(wrapper)
    await textarea.setValue('/zzz')
    await textarea.trigger('input')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.props('submit')).toHaveBeenCalledWith('/zzz')
  })

  it('普通文本输入不打开菜单', async () => {
    const wrapper = mountComposer()
    await wrapper.find('textarea').setValue('hello /world')
    await wrapper.find('textarea').trigger('input')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
```

`ConversationView.spec.ts`：fixture `task` 对象追加 `modelOverride: null, permissionModeOverride: null`；追加用例：

```ts
  it('把 local_command_output 渲染为带 CLI 标记的时间线条目', () => {
    const events = [
      event(1, 'user_message', { text: '/help' }),
      event(2, 'local_command_output', { content: 'Available commands' }),
    ]
    const wrapper = mount(ConversationView, { props: { task, events, cliReady: true } })
    const cli = wrapper.find('.cli-output')
    expect(cli.exists()).toBe(true)
    expect(cli.text()).toContain('CLI')
    expect(cli.text()).toContain('Available commands')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/services/slashCommands.spec.ts src/components/conversation/SlashCommandMenu.spec.ts src/components/conversation/ComposerBox.spec.ts src/components/conversation/ConversationView.spec.ts`
Expected: FAIL —— 模块/组件/行为不存在。

- [ ] **Step 3: 类型、IPC 与 i18n**

`src/domain/models.ts`：`TaskDto` 的 `claudeSessionId` 之后追加：

```ts
  modelOverride: string | null
  permissionModeOverride: TaskPermissionMode | null
```

`ProjectOpenWith` 类型之后追加：

```ts
export type TaskPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk'

export interface SlashCommandDto {
  name: string
  description: string
  argumentHint: string
  aliases: string[]
}

export interface ModelInfoDto {
  value: string
  displayName: string
  description: string
  resolvedModel: string | null
}

export interface SlashCommandCatalogDto {
  commands: SlashCommandDto[]
  models: ModelInfoDto[]
}

export interface SlashCommandsChanged {
  projectId: string
  catalog: SlashCommandCatalogDto
}
```

`src/domain/events.ts`：`TaskEventData` 的 `error` 之前追加：

```ts
  | { kind: 'local_command_output'; content: string }
```

`src/services/ipc.ts`：导入类型追加 `SlashCommandCatalogDto`；`ipc` 对象 `cancelTask` 之后追加（`force` 对应 Rust 侧 `list_slash_commands` 的可选参数，用于绕过 Rust 缓存强制刷新）：

```ts
  listSlashCommands: (projectId: string, force?: boolean) => invoke<SlashCommandCatalogDto>('list_slash_commands', { projectId, force }),
  setTaskModel: (taskId: string, model: string) => invoke<TaskDto>('set_task_model', { taskId, model }),
  setTaskPermissionMode: (taskId: string, mode: string) => invoke<TaskDto>('set_task_permission_mode', { taskId, mode }),
```

`src/services/i18n.ts`：`zhCN` 追加键（enUS 追加对应英文）：

```ts
  slashCommandMenu: '斜杠命令菜单',
  slashCommandsLoading: '正在从 CLI 加载命令…',
  slashCommandsEmpty: '没有匹配的命令',
  slashCommandsRetry: '重试',
  cliOutputLabel: 'CLI',
```

```ts
  slashCommandMenu: 'Slash command menu',
  slashCommandsLoading: 'Loading commands from CLI…',
  slashCommandsEmpty: 'No matching commands',
  slashCommandsRetry: 'Retry',
  cliOutputLabel: 'CLI',
```

- [ ] **Step 4: services/slashCommands.ts**

```ts
import { ipc } from './ipc'
import type { SlashCommandCatalogDto, SlashCommandDto } from '../domain/models'

const cache = new Map<string, Promise<SlashCommandCatalogDto>>()

export function loadSlashCommandCatalog(projectId: string, force = false): Promise<SlashCommandCatalogDto> {
  if (force) cache.delete(projectId)
  const existing = cache.get(projectId)
  if (existing) return existing
  const pending = ipc.listSlashCommands(projectId, force).catch((cause: unknown) => {
    cache.delete(projectId)
    throw cause
  })
  cache.set(projectId, pending)
  return pending
}

export function invalidateSlashCommandCatalog(projectId: string) {
  cache.delete(projectId)
}

export interface RankedSlashCommand {
  command: SlashCommandDto
  matchedAlias: string | null
}

export function filterSlashCommands(commands: SlashCommandDto[], query: string): RankedSlashCommand[] {
  const prefix = query.trim().replace(/^\//, '').toLowerCase()
  if (!prefix) return commands.map((command) => ({ command, matchedAlias: null }))
  const byName: RankedSlashCommand[] = []
  const byAlias: RankedSlashCommand[] = []
  for (const command of commands) {
    if (command.name.toLowerCase().startsWith(prefix)) byName.push({ command, matchedAlias: null })
    else {
      const alias = command.aliases.find((item) => item.toLowerCase().startsWith(prefix))
      if (alias) byAlias.push({ command, matchedAlias: alias })
    }
  }
  return [...byName, ...byAlias]
}
```

- [ ] **Step 5: SlashCommandMenu.vue**

```vue
<script setup lang="ts">
import { useI18n } from '../../services/i18n'
import type { RankedSlashCommand } from '../../services/slashCommands'

defineProps<{
  items: RankedSlashCommand[]
  activeIndex: number
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ select: [index: number]; retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="slash-menu" role="listbox" :aria-label="t('slashCommandMenu')">
    <div v-if="loading" class="slash-menu-state">{{ t('slashCommandsLoading') }}</div>
    <div v-else-if="error" class="slash-menu-state slash-menu-error">
      <span>{{ error }}</span>
      <button type="button" @click="emit('retry')">{{ t('slashCommandsRetry') }}</button>
    </div>
    <template v-else>
      <button v-for="(item, index) in items" :key="item.command.name" type="button" role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }" @click="emit('select', index)">
        <span class="slash-menu-name">/{{ item.command.name }}</span>
        <span v-if="item.matchedAlias" class="slash-menu-alias">{{ item.matchedAlias }}</span>
        <span v-if="item.command.argumentHint" class="slash-menu-hint">{{ item.command.argumentHint }}</span>
        <span class="slash-menu-desc">{{ item.command.description }}</span>
      </button>
      <div v-if="!items.length" class="slash-menu-state">{{ t('slashCommandsEmpty') }}</div>
    </template>
  </div>
</template>

<style scoped>
.slash-menu { position: absolute; z-index: 5; right: 0; bottom: calc(100% + 6px); left: 0; max-height: 264px; overflow: auto; padding: 6px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-composer); box-shadow: var(--shadow-lg); }
.slash-menu [role="option"] { display: flex; width: 100%; gap: 8px; align-items: baseline; padding: 7px 9px; border: 0; border-radius: 8px; background: none; cursor: pointer; text-align: left; }
.slash-menu [role="option"].active { background: var(--accent-soft); }
.slash-menu-name { flex: none; color: var(--text-primary); font: 600 12px var(--font-mono); }
.slash-menu-alias { flex: none; padding: 1px 5px; border: 1px solid var(--border-subtle); border-radius: 5px; color: var(--text-muted); font-size: 10px; }
.slash-menu-hint { flex: none; color: var(--text-muted); font: 10px var(--font-mono); }
.slash-menu-desc { min-width: 0; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.slash-menu-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; color: var(--text-muted); font-size: 12px; }
.slash-menu-error button { border: 0; background: none; color: var(--accent); cursor: pointer; font-size: 12px; text-decoration: underline; }
</style>
```

- [ ] **Step 6: ComposerBox 集成**

`ComposerBox.vue` script 部分：

1. 导入追加：

```ts
import SlashCommandMenu from './SlashCommandMenu.vue'
import { filterSlashCommands } from '../../services/slashCommands'
import type { SlashCommandDto } from '../../domain/models'
```

2. props 追加（`update` 之后）：

```ts
  commands?: SlashCommandDto[]
  commandsLoading?: boolean
  commandsError?: string
```

emits 追加：`'retry-commands': []`（并入现有 defineEmits 泛型）。

3. `const text = ref('')` 之后追加状态：

```ts
const caret = ref(0)
const menuOpen = ref(false)
const menuDismissed = ref(false)
const activeIndex = ref(0)

const slashToken = computed<{ start: number; query: string } | null>(() => {
  const before = text.value.slice(0, caret.value)
  const match = before.match(/(?:^|\n)(\/\S*)$/)
  return match ? { start: caret.value - match[1].length, query: match[1].slice(1) } : null
})
const filtered = computed(() => filterSlashCommands(props.commands ?? [], slashToken.value?.query ?? ''))

function syncCaret() {
  const el = textarea.value
  caret.value = el?.selectionStart ?? text.value.length
  menuOpen.value = !menuDismissed.value && slashToken.value !== null
}

watch(slashToken, () => {
  menuDismissed.value = false
  activeIndex.value = 0
  menuOpen.value = slashToken.value !== null
})
```

（`computed`/`watch` 加入现有 vue 导入。）

4. `keydown` 改为（菜单优先，保留原有多行/发送语义）：

```ts
function keydown(event: KeyboardEvent) {
  if (menuOpen.value && filtered.value.length > 0) {
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex.value = (activeIndex.value + 1) % filtered.value.length; return }
    if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length; return }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.isComposing) {
      event.preventDefault()
      insertCommand(filtered.value[activeIndex.value].command.name)
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); menuDismissed.value = true; menuOpen.value = false; return }
  }
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) return
  event.preventDefault()
  if (event.metaKey || event.ctrlKey) insertNewline()
  else send()
}
```

5. `insertNewline` 之后追加：

```ts
function insertCommand(name: string) {
  const el = textarea.value
  const caretNow = el?.selectionStart ?? text.value.length
  const token = slashToken.value
  const start = token && token.start <= caretNow ? token.start : caretNow
  text.value = `${text.value.slice(0, start)}/${name} ${text.value.slice(caretNow)}`
  menuOpen.value = false
  menuDismissed.value = false
  void nextTick(() => {
    const position = start + name.length + 2
    el?.focus()
    el?.setSelectionRange(position, position)
  })
}
```

6. textarea 标签追加事件（保留既有属性）：

```html
<textarea ref="textarea" v-model="text" rows="3" :disabled="disabled" placeholder="随心输入" :aria-label="t('sendMessage')" @keydown="keydown" @input="syncCaret" @keyup="syncCaret" @click="syncCaret" @select="syncCaret" />
```

7. 模板 `.composer` 内 `QueuedTurnList` 之后插入：

```html
    <SlashCommandMenu v-if="menuOpen" :items="filtered" :active-index="activeIndex" :loading="!!commandsLoading" :error="commandsError ?? ''" @select="insertCommand(filtered[$event].command.name)" @retry="emit('retry-commands')" />
```

（`defineEmits` 返回值命名为 `emit` 已存在。）

- [ ] **Step 7: ConversationView 目录加载与 CLI 输出渲染**

1. 导入追加：

```ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { loadSlashCommandCatalog, invalidateSlashCommandCatalog } from '../../services/slashCommands'
import type { SlashCommandCatalogDto, SlashCommandsChanged } from '../../domain/models'
```

2. `RenderItem` 的 `error` 之前追加：

```ts
  | { type: 'cli'; key: string; content: string }
```

`items` computed 的 switch `error` 分支之前追加：

```ts
      case 'local_command_output': result.push({ type: 'cli', key: `${event.runId}:${event.sequence}`, content: event.data.content }); break
```

3. `const unavailable` 之后追加目录状态与加载：

```ts
const catalog = ref<SlashCommandCatalogDto | null>(null)
const catalogLoading = ref(false)
const catalogError = ref('')
let unlistenCommands: UnlistenFn | undefined

async function reloadCatalog(force = false) {
  const projectId = props.task.projectId
  catalogLoading.value = true
  catalogError.value = ''
  try { catalog.value = await loadSlashCommandCatalog(projectId, force) }
  catch (cause) { catalogError.value = errorMessage(cause) }
  finally { catalogLoading.value = false }
}

watch(() => props.task.projectId, () => {
  catalog.value = null
  catalogError.value = ''
  void reloadCatalog()
}, { immediate: true })

onMounted(async () => {
  unlistenCommands = await listen<SlashCommandsChanged>('slash-commands-changed', ({ payload }) => {
    invalidateSlashCommandCatalog(payload.projectId)
    if (payload.projectId === props.task.projectId) catalog.value = payload.catalog
  }).catch(() => undefined)
})

onBeforeUnmount(() => unlistenCommands?.())
```

（`onMounted`/`onBeforeUnmount` 加入现有 vue 导入；jsdom 测试里 `listen` 会 reject，`.catch(() => undefined)` 避免未处理拒绝。）

4. `ComposerBox` 标签追加属性：

```html
      :commands="catalog?.commands ?? []"
      :commands-loading="catalogLoading"
      :commands-error="catalogError"
      @retry-commands="reloadCatalog(true)"
```

5. 模板 `ToolCard` 行之后追加：

```html
          <div v-else-if="item.type === 'cli'" class="cli-output"><span class="cli-badge">{{ t('cliOutputLabel') }}</span><pre>{{ item.content }}</pre></div>
```

样式追加：

```css
.cli-output { display: flex; gap: 10px; margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-header); }.cli-badge { flex: none; height: fit-content; padding: 2px 6px; border-radius: 5px; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 700; }.cli-output pre { min-width: 0; flex: 1; margin: 0; overflow: auto; color: var(--text-secondary); font: 11px/1.6 var(--font-mono); white-space: pre-wrap; }
```

- [ ] **Step 8: 运行目标测试与类型检查**

Run: `pnpm test -- src/services/slashCommands.spec.ts src/components/conversation/SlashCommandMenu.spec.ts src/components/conversation/ComposerBox.spec.ts src/components/conversation/ConversationView.spec.ts`
Expected: PASS

Run: `pnpm typecheck`
Expected: 无错误（注意 `stores/projects.ts` 等处若构造 TaskDto 字面量需补 `modelOverride: null, permissionModeOverride: null`）。

---

### Task 4: 原生命令路由与对话框

**Files:**
- Create: `src/components/conversation/SlashCommandDialog.vue`
- Create: `src/components/conversation/SlashCommandDialog.spec.ts`
- Modify: `src/components/conversation/ConversationView.vue`
- Modify: `src/components/conversation/ConversationView.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/services/i18n.ts`

**Interfaces:**
- Consumes: `ipc.setTaskModel`、`ipc.setTaskPermissionMode`、`catalog.models`、`task.modelOverride/permissionModeOverride`。
- Produces: `SlashCommandDialog`（kind: model | permissions）、ConversationView `open-settings` 事件、裸命令拦截路由。

- [ ] **Step 1: 写失败的路由与对话框测试**

新建 `src/components/conversation/SlashCommandDialog.spec.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/ipc', () => ({
  ipc: {
    setTaskModel: vi.fn().mockResolvedValue({}),
    setTaskPermissionMode: vi.fn().mockResolvedValue({}),
  },
  errorMessage: (error: unknown) => String((error as { message?: string })?.message ?? error),
  isDesktop: () => false,
}))
import SlashCommandDialog from './SlashCommandDialog.vue'
import { ipc } from '../../services/ipc'

const task = {
  id: 'task-1', projectId: 'project-1', title: '新任务', claudeSessionId: null,
  status: 'idle' as const, modelOverride: null, permissionModeOverride: null,
  createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
}
const models = [
  { value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', resolvedModel: null },
  { value: 'opus', displayName: 'Opus', description: 'Powerful', resolvedModel: null },
]

describe('SlashCommandDialog', () => {
  it('模型对话框列出目录模型与跟随应用设置，选择后调用 set_task_model', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    const options = wrapper.findAll('[data-option]')
    expect(options).toHaveLength(3)
    await options[1].trigger('click')
    expect(ipc.setTaskModel).toHaveBeenCalledWith('task-1', 'sonnet')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('跟随应用设置清除覆盖', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.findAll('[data-option]')[0].trigger('click')
    expect(ipc.setTaskModel).toHaveBeenCalledWith('task-1', '')
  })

  it('权限对话框只提供四个安全模式', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'permissions', task, models } })
    const options = wrapper.findAll('[data-option]')
    expect(options).toHaveLength(5)
    await options[1].trigger('click')
    expect(ipc.setTaskPermissionMode).toHaveBeenCalledWith('task-1', 'default')
  })

  it('失败时保留对话框并显示错误', async () => {
    vi.mocked(ipc.setTaskModel).mockRejectedValueOnce({ message: 'boom' })
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.findAll('[data-option]')[1].trigger('click')
    expect(wrapper.text()).toContain('boom')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('Escape 触发关闭且不调用 IPC', async () => {
    const wrapper = mount(SlashCommandDialog, { props: { kind: 'model', task, models } })
    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(ipc.setTaskModel).not.toHaveBeenCalled()
  })
})
```

`ConversationView.spec.ts` 追加（文件顶部 `vi` 加入 vitest 导入，并补一个 mock 过的 submit）：

```ts
  it('裸 /model 打开对话框而不发送', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('裸 /config 触发 open-settings 而不发送', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/config')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).not.toHaveBeenCalled()
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  it('带参数命令与 Skill 原样透传', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ConversationView, { props: { task, events: [], cliReady: true, submit } })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('/model sonnet')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    expect(submit).toHaveBeenCalledWith('/model sonnet')
  })
```

注意：这些用例里 `submit` 传入后 ComposerBox 的发送会清空输入并调用 submit —— 因为 `/model` 为裸命令被拦截，输入应保留（不调用 submit、不清空）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/conversation/SlashCommandDialog.spec.ts src/components/conversation/ConversationView.spec.ts`
Expected: FAIL —— `SlashCommandDialog` 不存在、路由行为缺失。

- [ ] **Step 3: SlashCommandDialog.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../../services/i18n'
import { errorMessage, ipc } from '../../services/ipc'
import type { ModelInfoDto, TaskDto, TaskPermissionMode } from '../../domain/models'

export type SlashDialogKind = 'model' | 'permissions'

const props = defineProps<{ kind: SlashDialogKind; task: TaskDto; models: ModelInfoDto[] }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const saving = ref(false)
const error = ref('')

const permissionModes = [
  { value: 'default', labelKey: 'permDefault', descriptionKey: 'permDefaultDesc' },
  { value: 'acceptEdits', labelKey: 'permAcceptEdits', descriptionKey: 'permAcceptEditsDesc' },
  { value: 'plan', labelKey: 'permPlan', descriptionKey: 'permPlanDesc' },
  { value: 'dontAsk', labelKey: 'permDontAsk', descriptionKey: 'permDontAskDesc' },
] as const satisfies ReadonlyArray<{ value: TaskPermissionMode }>

async function chooseModel(value: string) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await ipc.setTaskModel(props.task.id, value)
    emit('close')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { saving.value = false }
}

async function choosePermissionMode(value: string) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await ipc.setTaskPermissionMode(props.task.id, value)
    emit('close')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="dialog-backdrop" @keydown.escape="emit('close')">
    <div class="slash-dialog" role="dialog" aria-modal="true" :aria-label="kind === 'model' ? t('selectModel') : t('selectPermissionMode')">
      <h2>{{ kind === 'model' ? t('selectModel') : t('selectPermissionMode') }}</h2>
      <div class="dialog-options">
        <button type="button" data-option :class="{ selected: kind === 'model' ? !task.modelOverride : !task.permissionModeOverride }" :disabled="saving" @click="kind === 'model' ? chooseModel('') : choosePermissionMode('')">
          <span class="option-label">{{ t('followAppSettings') }}</span>
        </button>
        <template v-if="kind === 'model'">
          <button v-for="model in models" :key="model.value" type="button" data-option :class="{ selected: task.modelOverride === model.value }" :disabled="saving" @click="chooseModel(model.value)">
            <span class="option-label">{{ model.displayName }}</span>
            <span class="option-desc">{{ model.description }}</span>
          </button>
        </template>
        <template v-else>
          <button v-for="mode in permissionModes" :key="mode.value" type="button" data-option :class="{ selected: task.permissionModeOverride === mode.value }" :disabled="saving" @click="choosePermissionMode(mode.value)">
            <span class="option-label">{{ t(mode.labelKey) }}</span>
            <span class="option-desc">{{ t(mode.descriptionKey) }}</span>
          </button>
        </template>
      </div>
      <p v-if="error" class="dialog-error">{{ error }}</p>
      <div class="dialog-footer"><button type="button" class="cancel" :disabled="saving" @click="emit('close')">{{ t('dialogCancel') }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; z-index: 40; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 45%); }
.slash-dialog { display: flex; width: min(420px, calc(100vw - 48px)); flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--border-strong); border-radius: 16px; background: var(--surface-composer); box-shadow: var(--shadow-lg); }
.slash-dialog h2 { margin: 0; font-size: 14px; }
.dialog-options { display: flex; max-height: 320px; flex-direction: column; gap: 6px; overflow: auto; }
.dialog-options button { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 1px solid var(--border-subtle); border-radius: 10px; background: none; cursor: pointer; text-align: left; }
.dialog-options button.selected { border-color: var(--accent-border); background: var(--accent-soft); }
.option-label { color: var(--text-primary); font-size: 12px; font-weight: 600; }
.option-desc { color: var(--text-muted); font-size: 11px; }
.dialog-error { margin: 0; color: var(--text-danger); font-size: 12px; }
.dialog-footer { display: flex; justify-content: flex-end; }
.dialog-footer .cancel { padding: 6px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; }
</style>
```

- [ ] **Step 4: i18n 对话框文案**

`zhCN` 追加：

```ts
  selectModel: '选择模型',
  selectPermissionMode: '选择权限模式',
  followAppSettings: '跟随应用设置',
  dialogCancel: '取消',
  permDefault: '默认（每次询问）',
  permDefaultDesc: '工具调用前逐次请求授权',
  permAcceptEdits: '智能放行（编辑）',
  permAcceptEditsDesc: '自动允许文件编辑，其余仍会询问',
  permPlan: '计划模式',
  permPlanDesc: '只读分析，不执行修改',
  permDontAsk: '不再询问',
  permDontAskDesc: '自动允许当前会话的工具调用',
```

`enUS` 追加：

```ts
  selectModel: 'Select model',
  selectPermissionMode: 'Select permission mode',
  followAppSettings: 'Follow app settings',
  dialogCancel: 'Cancel',
  permDefault: 'Default (ask every time)',
  permDefaultDesc: 'Each tool use asks for approval',
  permAcceptEdits: 'Accept edits',
  permAcceptEditsDesc: 'Auto-allow file edits; everything else still asks',
  permPlan: 'Plan mode',
  permPlanDesc: 'Read-only analysis without changes',
  permDontAsk: "Don't ask",
  permDontAskDesc: 'Auto-allow tool use for this session',
```

- [ ] **Step 5: ConversationView 路由**

1. 导入追加 `SlashCommandDialog` 与 `SlashDialogKind`（`import SlashCommandDialog, { type SlashDialogKind } from './SlashCommandDialog.vue'`）。
2. emits 改为 `defineEmits<{ stop: []; 'open-settings': [] }>()`。
3. `const unavailable` 之后追加：

```ts
const dialog = ref<SlashDialogKind | null>(null)
const composer = ref<InstanceType<typeof ComposerBox> | null>(null)

async function submitTurn(value: string) {
  const bare = value.trim()
  if (bare === '/config') { emit('open-settings'); return }
  if (bare === '/model' || bare === '/permissions') { dialog.value = bare.slice(1) as SlashDialogKind; return }
  await (props.submit ?? unavailable)(value)
}

function closeDialog() {
  dialog.value = null
  composer.value?.focus()
}
```

4. `ComposerBox` 标签：`ref="composer"`、`:submit="submitTurn"`（替换原来的 `:submit="submit ?? unavailable"`）。
5. 模板 `InlineError` 之前插入：

```html
    <SlashCommandDialog v-if="dialog" :kind="dialog" :task="task" :models="catalog?.models ?? []" @close="closeDialog" />
```

6. `ComposerBox.vue` script 末尾追加（供对话框关闭后恢复焦点）：

```ts
defineExpose({ focus: () => textarea.value?.focus() })
```

- [ ] **Step 6: App.vue 接线**

`ConversationView` 标签追加：

```html
        @open-settings="openSettings"
```

（`slash-commands-changed` 监听已在 Task 3 Step 7 于 ConversationView 内完成，App 不需要重复处理。）

- [ ] **Step 7: 运行组件测试与全量前端验证**

Run: `pnpm test -- src/components/conversation/SlashCommandDialog.spec.ts src/components/conversation/ConversationView.spec.ts`
Expected: PASS

Run: `pnpm test`
Expected: 全部 PASS

Run: `pnpm typecheck`
Expected: 无错误。

---

### Task 5: 集成验证

**Files:**
- Modify only if verification finds a failing behavior: files already listed above.

- [ ] **Step 1: 构建并运行全部自动化套件**

Run: `pnpm bridge:build:dev`

Run: `pnpm bridge:test`

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 2: 确认工作区状态**

Run: `git diff --check`（无空白错误）
Run: `git status --short` —— 只应有本计划列出的文件改动 + 两份设计文档；**不创建任何提交**。

- [ ] **Step 3: 桌面冒烟测试（tauri:dev）**

逐项验证：
1. 输入 `/` 弹出完整目录（含用户级与项目级 Skill）。
2. ↑↓ 移动、Enter/Tab 填入 `/<name> `，不自动发送；Esc 关闭。
3. 选择一个 Skill 补参数执行，行为与 CLI 一致。
4. `/help` 后时间线出现带 “CLI” 标记的本地输出。
5. 裸 `/model` 打开模型对话框，选择后下一轮生效；「跟随应用设置」可清除。
6. 裸 `/permissions` 打开权限对话框，四种模式可选。
7. 裸 `/config` 打开现有设置视图。
8. 断开/伪装 CLI 不可用时目录加载失败显示重试，普通聊天不受影响。

- [ ] **Step 4: 冒烟失败时**

先为失败行为补一个聚焦的失败测试，再做最小实现修复，并重跑受影响的套件。
