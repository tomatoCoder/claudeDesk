# 权限模式设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页新增「权限模式」下拉（每次询问我 / 智能放行 / 全部放行），持久化到 app 级设置，并在发起 Claude run 时透传给 SDK。

**Architecture:** 设置存 SQLite `settings` 表（`AppSettingsDto` 新增 `permission_mode` 字段，serde default 兼容旧数据）。协调器把该字段映射为 bridge 协议值（`auto` / `bypassPermissions`）写进 `run.start`；bridge 把它透传给 SDK `query()` 的 `permissionMode` 选项，`bypassPermissions` 时同时设 `allowDangerouslySkipPermissions: true`。

**Tech Stack:** Tauri 2 + Rust（serde/rusqlite）、Vue 3 + Pinia、Node bridge（@anthropic-ai/claude-agent-sdk）、Vitest、cargo test。

**Spec:** `docs/superpowers/specs/2026-09-12-permission-mode-setting-design.md`

**值映射（全计划通用，勿混淆）：**

| 含义 | DB / 前端值（Rust enum snake_case） | bridge 线上协议值（SDK PermissionMode） |
|---|---|---|
| 每次询问我 | `default` | 不发字段（SDK 默认 `default`） |
| 智能放行 | `auto` | `auto` |
| 全部放行 | `bypass` | `bypassPermissions` |

---

### Task 1: Rust 数据模型 — AppPermissionMode

**Files:**
- Modify: `src-tauri/src/domain.rs:215-264`（AppSettingsDto、ProjectOpenWith 之后、Default impl）
- Test: `src-tauri/tests/app_settings.rs`（新建）

- [ ] **Step 1: 写失败的集成测试**

新建 `src-tauri/tests/app_settings.rs`：

```rust
use claude_desk_lib::domain::{AppPermissionMode, AppSettingsDto};
use claude_desk_lib::storage::Storage;

#[test]
fn legacy_settings_json_without_permission_mode_deserializes_to_default() {
    let legacy = r#"{"claudePath":null,"sidebarWidth":280,"theme":"system","language":"zh-CN","openWith":"default"}"#;
    let settings: AppSettingsDto = serde_json::from_str(legacy).unwrap();
    assert_eq!(settings.permission_mode, AppPermissionMode::Default);
}

#[test]
fn permission_mode_roundtrips_through_storage() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(temp.path().join("app.db")).unwrap();
    let mut settings = storage.load_settings().unwrap();
    settings.permission_mode = AppPermissionMode::Bypass;
    storage.save_settings(&settings).unwrap();
    assert_eq!(storage.load_settings().unwrap().permission_mode, AppPermissionMode::Bypass);
}

#[test]
fn app_settings_serialize_permission_mode_camel_case() {
    let settings = AppSettingsDto { permission_mode: AppPermissionMode::Auto, ..AppSettingsDto::default() };
    let json = serde_json::to_value(&settings).unwrap();
    assert_eq!(json["permissionMode"], "auto");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_settings`
Expected: 编译失败，`no field 'permission_mode'` / `cannot find type 'AppPermissionMode'`

- [ ] **Step 3: 写最小实现**

`src-tauri/src/domain.rs` — 在 `ProjectOpenWith` 枚举（约 246-252 行）之后加：

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppPermissionMode {
    #[default]
    Default,
    Auto,
    Bypass,
}
```

`AppSettingsDto`（约 215-224 行）在 `open_with` 字段后加一个字段：

```rust
    #[serde(default)]
    pub permission_mode: AppPermissionMode,
```

`impl Default for AppSettingsDto`（约 254-264 行）加一行：

```rust
            permission_mode: AppPermissionMode::default(),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_settings`
Expected: 3 个测试 PASS

- [ ] **Step 5: 跑全部 Rust 测试确认无回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain.rs src-tauri/tests/app_settings.rs
git commit -m "feat(domain): 应用设置新增权限模式字段

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Rust 协调器 — run.start 携带 permissionMode

**Files:**
- Modify: `src-tauri/src/task/coordinator.rs`（`run()` 约 215-231 行；`mod tests` 约 572 行；domain 导入约 23 行）

说明：把 `run.start` 的构建从 `run()` 内联代码提取为自由函数 `build_run_start`，这样能对它做单元测试（`run()` 本身需要 AppHandle + 真实 bridge 进程，不可单测）。

- [ ] **Step 1: 写失败的单元测试**

`src-tauri/src/task/coordinator.rs` 底部 `mod tests`（约 572 行）中，把现有 use 语句改为：

```rust
    use super::{build_run_start, spawn_background};
    use crate::domain::AppPermissionMode;
    use std::{path::Path, sync::mpsc, time::Duration};
```

并在 `mod tests` 内追加两个测试：

```rust
    #[test]
    fn run_start_omits_permission_mode_when_default() {
        let start = build_run_start(
            "run-1", Path::new("/usr/local/bin/claude"), Path::new("/workspace"), "你好",
            None, "", AppPermissionMode::Default,
        );
        assert_eq!(start["type"], "run.start");
        assert_eq!(start["runId"], "run-1");
        assert!(start.get("permissionMode").is_none());
    }

    #[test]
    fn run_start_maps_permission_modes_to_bridge_values() {
        let auto = build_run_start(
            "run-1", Path::new("/usr/local/bin/claude"), Path::new("/workspace"), "你好",
            None, "", AppPermissionMode::Auto,
        );
        assert_eq!(auto["permissionMode"], "auto");

        let bypass = build_run_start(
            "run-1", Path::new("/usr/local/bin/claude"), Path::new("/workspace"), "你好",
            Some("session-1"), "gateway-sonnet", AppPermissionMode::Bypass,
        );
        assert_eq!(bypass["permissionMode"], "bypassPermissions");
        assert_eq!(bypass["sessionId"], "session-1");
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml permission_mode`
Expected: 编译失败，`cannot find function 'build_run_start'`

- [ ] **Step 3: 写实现**

`src-tauri/src/task/coordinator.rs`：

(a) 23 行 domain 导入列表中加入 `AppPermissionMode`：

```rust
    domain::{AppPermissionMode, CliDiagnosticStatus, PermissionDecisionKind, QueuedTurnDto, QueuedTurnsChanged, RunAccepted, TaskEvent, TaskEventPayload, TaskStatus, TurnSubmission, UserQuestion},
```

(b) 把 `run()` 中（约 216-231 行）：

```rust
        let managed = self.settings.load()?.values;
        let mut start = json!({
            "v": 1,
            "type": "run.start",
            "requestId": uuid::Uuid::new_v4().to_string(),
            "runId": run_id,
            "claudePath": executable,
            "cwd": cwd,
            "prompt": prompt,
        });
        if let Some(session_id) = session_id.as_deref() {
            start["sessionId"] = Value::String(session_id.into());
        } else if !managed.model.trim().is_empty() {
            start["model"] = Value::String(managed.model);
        }
        write_control(&mut child, &start)?;
```

替换为：

```rust
        let managed = self.settings.load()?.values;
        let permission_mode = self.storage.load_settings()?.permission_mode;
        let start = build_run_start(&run_id, &executable, &cwd, &prompt, session_id.as_deref(), &managed.model, permission_mode);
        write_control(&mut child, &start)?;
```

(c) 在 `validate_prompt` 函数（约 517 行）之前加两个自由函数：

```rust
fn build_run_start(
    run_id: &str,
    executable: &std::path::Path,
    cwd: &std::path::Path,
    prompt: &str,
    session_id: Option<&str>,
    model: &str,
    permission_mode: AppPermissionMode,
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
    if let Some(mode) = bridge_permission_mode(permission_mode) {
        start["permissionMode"] = Value::String(mode.into());
    }
    start
}

fn bridge_permission_mode(mode: AppPermissionMode) -> Option<&'static str> {
    match mode {
        AppPermissionMode::Default => None,
        AppPermissionMode::Auto => Some("auto"),
        AppPermissionMode::Bypass => Some("bypassPermissions"),
    }
}
```

注意：`json!` 对表达式按引用序列化（现有代码里 `run_id`/`request_id` 在 `json!` 之后仍被使用可证），传 `&Path` 不会移动原值。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml permission_mode`
Expected: 2 个新测试 PASS

- [ ] **Step 5: 跑全部 Rust 测试确认无回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/task/coordinator.rs
git commit -m "feat(task): run.start 按应用设置携带权限模式

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Bridge — 协议扩展 + SDK 选项

**Files:**
- Modify: `bridge/src/protocol.ts:39`（RunStartRequest.permissionMode 联合类型）
- Modify: `bridge/src/agent-adapter.ts:23-34`（buildQueryOptions）
- Test: `bridge/src/agent-adapter.test.ts`（追加用例）

- [ ] **Step 1: 写失败的单元测试**

`bridge/src/agent-adapter.test.ts` 的 `describe` 内追加：

```ts
  it('全部放行模式要求 SDK 显式确认跳过权限检查', () => {
    const options = buildQueryOptions({ claudePath: '/usr/local/bin/claude', cwd: '/workspace', permissionMode: 'bypassPermissions' })
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
  })

  it('智能放行模式原样透传且不跳过权限检查', () => {
    const options = buildQueryOptions({ claudePath: '/usr/local/bin/claude', cwd: '/workspace', permissionMode: 'auto' })
    expect(options.permissionMode).toBe('auto')
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
  })

  it('未指定权限模式时保持每次询问', () => {
    const options = buildQueryOptions({ claudePath: '/usr/local/bin/claude', cwd: '/workspace' })
    expect(options.permissionMode).toBe('default')
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm bridge:test`
Expected: 前两个用例 FAIL——`'bypassPermissions'` / `'auto'` 不在类型联合里，且 `allowDangerouslySkipPermissions` 未设置

- [ ] **Step 3: 写实现**

(a) `bridge/src/protocol.ts` 39 行改为：

```ts
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'auto' | 'bypassPermissions'
```

(b) `bridge/src/agent-adapter.ts` 的 `buildQueryOptions` 中，在 `if (context.sessionId) options.resume = context.sessionId` 之前加：

```ts
  if (context.permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true
```

（`QueryContext.permissionMode` 已经是 SDK 的 `PermissionMode` 类型；protocol 扩展后 `main.ts` 直接把 `RunStartRequest` 传入 `buildQueryOptions`，无需改动。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm bridge:test`
Expected: 全部 PASS（含原有用例）

- [ ] **Step 5: 类型检查**

Run: `pnpm bridge:typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add bridge/src/protocol.ts bridge/src/agent-adapter.ts bridge/src/agent-adapter.test.ts
git commit -m "feat(bridge): 支持智能放行与全部放行权限模式

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 前端类型、store 初始值与 i18n 文案

**Files:**
- Modify: `src/domain/models.ts:21-31`
- Modify: `src/stores/projects.ts:11`
- Modify: `src/services/i18n.ts:118`（zh-CN）与 `i18n.ts:246`（en-US）

纯类型与常量，无独立测试；由 Task 5 的组件测试和 `pnpm typecheck` 验证。

- [ ] **Step 1: models.ts 加类型**

`src/domain/models.ts` — `AppSettingsDto`（21-27 行）加字段，`ProjectOpenWith`（31 行）之后加类型：

```ts
export interface AppSettingsDto {
  claudePath: string | null
  sidebarWidth: number
  theme: ThemePreference
  language: AppLanguage
  openWith: ProjectOpenWith
  permissionMode: AppPermissionMode
}

export type ThemePreference = 'system' | 'dark' | 'light'
export type AppLanguage = 'zh-CN' | 'en-US'
export type ProjectOpenWith = 'default' | 'qoder' | 'vscode' | 'intellij_idea'
export type AppPermissionMode = 'default' | 'auto' | 'bypass'
```

- [ ] **Step 2: store 初始值加字段**

`src/stores/projects.ts` 11 行改为：

```ts
  const settings = ref<AppSettingsDto>({ claudePath: null, sidebarWidth: 280, theme: 'system', language: 'zh-CN', openWith: 'default', permissionMode: 'default' })
```

- [ ] **Step 3: i18n 中文文案**

`src/services/i18n.ts` — 删除 118 行的 `permissionNote: '文件和命令访问权限会在 Claude 请求执行时由你确认。',`，原位替换为：

```ts
  permissionMode: '权限模式',
  permissionModeHelp: '控制 Claude 使用文件和命令前的确认方式，对下一条消息起生效。',
  permissionAskEveryTime: '每次询问我',
  permissionSmartApprove: '智能放行',
  permissionAllowAll: '全部放行',
  permissionBypassWarning: '全部放行会跳过所有权限检查，Claude 将不经确认直接执行命令和修改文件，请谨慎使用。',
```

- [ ] **Step 4: i18n 英文文案**

同文件 246 行删除 `permissionNote: 'You will be asked before Claude can access files or run commands.',`，原位替换为：

```ts
  permissionMode: 'Permission mode',
  permissionModeHelp: 'Controls how Claude confirms before using files or commands. Takes effect on the next message.',
  permissionAskEveryTime: 'Ask every time',
  permissionSmartApprove: 'Smart approve',
  permissionAllowAll: 'Allow all',
  permissionBypassWarning: 'Allow all skips every permission check — Claude will run commands and edit files without asking. Use with care.',
```

（`TranslationKey = keyof typeof zhCN`，enUS 是 `Record<TranslationKey, string>`——两边键必须同时增删。）

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/domain/models.ts src/stores/projects.ts src/services/i18n.ts
git commit -m "feat(app): 权限模式类型定义与本地化文案

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: SettingsView UI + 组件测试

**Files:**
- Modify: `src/components/diagnostics/SettingsView.vue`
- Test: `src/components/diagnostics/SettingsView.spec.ts`

- [ ] **Step 1: 写失败的组件测试**

`src/components/diagnostics/SettingsView.spec.ts` 的 `describe` 内追加：

```ts
  it('展示权限模式三选项并按当前设置选中', () => {
    const wrapper = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' }, permissionMode: 'auto' },
    })

    const select = wrapper.get('select[name="permissionMode"]').element as HTMLSelectElement
    expect(select.value).toBe('auto')
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['default', 'auto', 'bypass'])
  })

  it('切换权限模式时发出事件', async () => {
    const wrapper = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' } },
    })

    await wrapper.get('select[name="permissionMode"]').setValue('bypass')

    expect(wrapper.emitted('permissionModeChange')?.[0]).toEqual(['bypass'])
  })

  it('仅在全部放行时显示警示', () => {
    const quiet = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' } },
    })
    expect(quiet.find('.permission-warning').exists()).toBe(false)

    const bypass = mount(SettingsView, {
      props: { settings, cli: { status: 'ready', path: '/usr/bin/claude', version: '2.1.266', message: 'ready' }, permissionMode: 'bypass' },
    })
    expect(bypass.find('.permission-warning').exists()).toBe(true)
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- SettingsView`
Expected: 3 个新用例 FAIL（找不到 `select[name="permissionMode"]`）

- [ ] **Step 3: 写实现**

`src/components/diagnostics/SettingsView.vue`：

(a) 类型导入（4-13 行）加 `AppPermissionMode`：

```ts
import type {
  AppLanguage,
  AppPermissionMode,
  ClaudeSettingsDto,
  CliDiagnosticDto,
  ManagedClaudeSettings,
  ProjectOpenWith,
  SaveClaudeSettingsInput,
  SaveClaudeSettingsJsonInput,
  ThemePreference,
} from '../../domain/models'
```

(b) props 加 `permissionMode?: AppPermissionMode`，withDefaults 加默认值（19-28 行）：

```ts
const props = withDefaults(defineProps<{
  settings: ClaudeSettingsDto
  theme?: ThemePreference
  language?: AppLanguage
  openWith?: ProjectOpenWith
  permissionMode?: AppPermissionMode
  cli: CliDiagnosticDto
  saving?: boolean
  externalConflict?: boolean
  error?: string
}>(), { theme: 'system', language: 'zh-CN', openWith: 'default', permissionMode: 'default' })
```

(c) emits 加一行（29-39 行）：

```ts
  permissionModeChange: [permissionMode: AppPermissionMode]
```

(d) `changeOpenWith` 函数（134-136 行）之后加：

```ts
function changePermissionMode(event: Event) {
  emit('permissionModeChange', (event.target as HTMLSelectElement).value as AppPermissionMode)
}
```

(e) 模板：app-grid 内「打开方式」label（244-253 行）之后加第四个字段：

```html
              <label class="field">
                <span>{{ t('permissionMode') }}</span>
                <small>{{ t('permissionModeHelp') }}</small>
                <select name="permissionMode" :value="permissionMode" @change="changePermissionMode">
                  <option value="default">{{ t('permissionAskEveryTime') }}</option>
                  <option value="auto">{{ t('permissionSmartApprove') }}</option>
                  <option value="bypass">{{ t('permissionAllowAll') }}</option>
                </select>
              </label>
```

(f) 模板：255 行 `<div class="permission-note">{{ t('permissionNote') }}</div>` 替换为：

```html
            <div v-if="permissionMode === 'bypass'" class="permission-note permission-warning">{{ t('permissionBypassWarning') }}</div>
```

(g) style：`.permission-note` 规则所在行（285 行）末尾追加一条规则：

```css
.permission-warning { border: 1px solid var(--danger-border); background: var(--danger-soft); color: var(--text-danger); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- SettingsView`
Expected: 全部 PASS（含原有用例）

- [ ] **Step 5: Commit**

```bash
git add src/components/diagnostics/SettingsView.vue src/components/diagnostics/SettingsView.spec.ts
git commit -m "feat(settings): 设置页权限模式下拉与全部放行警示

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: App.vue 接线

**Files:**
- Modify: `src/App.vue`（导入 5 行、changeOpenWith 之后 254 行、SettingsView 绑定 281/289 行）

沿用 `changeOpenWith` 的乐观更新 + 失败回滚模式。App.vue 无组件测试（与 theme/language/openWith 一致），由 `pnpm typecheck` + 手动验证覆盖。

- [ ] **Step 1: 导入类型**

`src/App.vue` 5 行的类型导入加 `AppPermissionMode`：

```ts
import type { AppLanguage, AppPermissionMode, ClaudeSettingsDto, ProjectOpenWith, SaveClaudeSettingsInput, SaveClaudeSettingsJsonInput, ThemePreference } from './domain/models'
```

- [ ] **Step 2: 加处理函数**

`changeOpenWith`（243-254 行）之后加：

```ts
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
```

- [ ] **Step 3: 模板绑定**

`<SettingsView>`（276-295 行）加 prop 与事件：

```html
        :open-with="projects.settings.openWith"
        :permission-mode="projects.settings.permissionMode"
```

```html
        @open-with-change="changeOpenWith"
        @permission-mode-change="changePermissionMode"
```

- [ ] **Step 4: 类型检查 + 全量前端测试**

Run: `pnpm typecheck && pnpm test`
Expected: 均无错误 / 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.vue
git commit -m "feat(app): 接通权限模式设置的读取与保存

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 全量验证

- [ ] **Step 1: Rust 全量测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS

- [ ] **Step 2: Bridge 测试 + 类型检查**

Run: `pnpm bridge:test && pnpm bridge:typecheck`
Expected: 全部 PASS / 无错误

- [ ] **Step 3: 前端测试 + 类型检查**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS / 无错误

- [ ] **Step 4: 手动冒烟（可选但推荐）**

Run: `pnpm tauri:dev`
验证：设置 → App 区块出现「权限模式」下拉；切到「全部放行」出现红色警示；重启后设置保留；选「智能放行」后发消息，安全操作不再弹 PermissionCard。

- [ ] **Step 5: 最终提交（如有零散改动）**

```bash
git status
# 若有未提交改动：
git add -A && git commit -m "chore: 权限模式设置收尾

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
