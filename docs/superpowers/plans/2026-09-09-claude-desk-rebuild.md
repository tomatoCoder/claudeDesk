# Claude Desk 从零重建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `feat/claude-desk-mvp` 分支原地重构 Claude Desk，保留用户未提交的协议类型修改，移除旧版超范围功能，交付可安装的 macOS Apple Silicon DMG 和 Windows x64 NSIS 安装程序，并完成“项目 → 会话 → 对话 → 权限 → 设置”的最小闭环。

**Architecture:** Vue 3 + TypeScript 只负责界面和临时展示状态；Tauri/Rust 负责可信文件访问、CLI 检测、sidecar 进程监管、设置同步、删除与退出；独立 TypeScript Agent Bridge 使用官方 Claude Agent SDK，并明确指向用户本机安装的 Claude CLI。每个活动轮次启动独立 Bridge worker，通过带版本号的 JSONL 协议与 Rust 通信，从而隔离并行会话故障。

**Tech Stack:** Tauri 2、Rust 1.88+、Vue 3.5.42、TypeScript 7.0.2、Pinia 4、Vite 8、Vitest 5、Vue Test Utils、Claude Agent SDK 0.3.266、Bun 1.3+、pnpm 11、Tokio、Serde、Notify、Trash。

**Spec:** `docs/superpowers/specs/2026-09-09-claude-desk-minimum-closed-loop-design.md`

## Global Constraints

- 产品名固定为 `Claude Desk`，Tauri 标识固定为 `com.claudedesk.desktop`。
- 当前目录包含旧版 MVP；先记录基线并以测试保护可复用行为，再删除 Git Diff、终端、SQLite 任务系统等已排除功能。不得回滚开始实施前已有的 `Cargo.toml`、Rust/TypeScript permission 类型修改。
- 只支持 macOS 13.0+ Apple Silicon 和原生 Windows 10/11 x64；不支持 Intel Mac、Windows ARM64 和 WSL。
- 要求用户另行安装并认证 Claude CLI；App 不下载、不内置、不更新 CLI，也不提供登录流程。
- Claude CLI 最低版本为 `2.1.223`，因为该版本起支持跨项目查找 session ID；低版本显示升级引导。
- Agent SDK 固定为 `0.3.266`，通过 `pathToClaudeCodeExecutable` 使用用户本机 CLI，不使用 SDK 的可选内置 CLI 二进制包。
- 新会话读取当前 `ANTHROPIC_MODEL`；恢复会话不传 `model` 覆盖参数。
- 用户级设置路径只使用 `~/.claude/settings.json` 或 `%USERPROFILE%\.claude\settings.json`。
- 设置页只管理 `env.ANTHROPIC_AUTH_TOKEN`、`env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_MODEL`，其他 JSON 语义保持不变。
- Token 不得进入日志、错误详情、前端持久化状态、测试快照或命令行参数。
- 同一 session ID 同时只能有一个活动轮次；不同会话不设置全局并发上限。
- 所有权限请求必须由用户明确允许或拒绝；连接断开、超时、停止或退出时默认拒绝。
- `AskUserQuestion` 通过同一交互通道展示，避免 SDK 永久等待；这属于保证对话闭环的兼容处理，不扩展产品范围。
- 前端不获得通用 shell 或文件系统能力；所有高权限操作都通过参数严格校验的 Tauri 命令完成。
- 会话删除必须先解析并展示精确目标，只允许移动 Claude 数据目录内匹配 session ID 的文件到系统废纸篓或回收站。
- App 不采集遥测，不创建自动更新器，不发布 Release，不做代码签名或公证。
- 所有行为变更遵循 TDD：先写失败测试，再做最小实现，然后运行聚焦测试和相关全量测试。
- 每个任务只提交该任务涉及的文件；执行时如发现用户改动，先保留并重新规划，不得覆盖。

## Scope Check

本规格包含 Bridge、Rust 桌面核心、设置和会话数据、Vue 界面及双平台打包。它们不是可独立交付的产品，而是同一条安装后可用闭环的顺序依赖，因此保留为一份计划；每个任务仍提供独立可测试、可审查的交付物。

## Locked File Map

### 根目录与构建

- `.gitignore`：忽略依赖、构建产物、sidecar 二进制、日志和本地配置。
- `package.json`：前端依赖与统一的测试、构建、打包命令。
- `pnpm-workspace.yaml`：包含根前端和 `bridge` workspace。
- `pnpm-lock.yaml`：固定 JavaScript 依赖图。
- `index.html`、`tsconfig.json`、`tsconfig.node.json`、`vite.config.ts`：Vue/Vite/Vitest 配置。
- `scripts/build-sidecar.mjs`：按当前目标编译并命名 Bridge sidecar。
- `.github/workflows/build-installers.yml`：macOS arm64 和 Windows x64 手动构建矩阵，不发布 Release。

### Agent Bridge

- `bridge/package.json`、`bridge/tsconfig.json`、`bridge/vitest.config.ts`：独立 TypeScript sidecar 包。
- `bridge/src/protocol.ts`：Rust 与 Bridge 共识的 JSONL 请求、响应和事件类型。
- `bridge/src/jsonl.ts`：逐行读取 stdin、严格解析和写入 stdout。
- `bridge/src/agent-adapter.ts`：隔离官方 SDK 的接口，允许测试注入 fake adapter。
- `bridge/src/catalog.ts`：`listSessions/getSessionMessages/getSessionInfo/renameSession` 适配。
- `bridge/src/normalize.ts`：SDK 消息到稳定事件的转换。
- `bridge/src/run-worker.ts`：单轮次 `query()`、权限等待、取消和结果处理。
- `bridge/src/main.ts`：`handshake`、`catalog`、`run` 三种运行模式入口。
- `bridge/src/*.spec.ts`：协议、目录、事件、权限和并行隔离测试。

### Tauri/Rust

- `src-tauri/Cargo.toml`、`src-tauri/build.rs`、`src-tauri/tauri.conf.json`：Rust crate 和桌面打包配置。
- `src-tauri/capabilities/default.json`：最小权限声明，不授予前端 shell 权限。
- `src-tauri/src/main.rs`、`src-tauri/src/lib.rs`：应用入口、插件、状态、命令和退出钩子。
- `src-tauri/src/domain.rs`：与前端及 Bridge 对齐的 DTO。
- `src-tauri/src/error.rs`：稳定错误码和安全错误消息。
- `src-tauri/src/cli/locator.rs`：跨平台 Claude CLI 定位、版本检测和诊断。
- `src-tauri/src/bridge/protocol.rs`：Bridge JSONL 的 Rust 类型。
- `src-tauri/src/bridge/catalog.rs`：短生命周期目录命令。
- `src-tauri/src/bridge/worker.rs`：活动 run worker 的启动、输入、事件和退出。
- `src-tauri/src/runs/registry.rs`：无全局上限的活动轮次注册表及同会话互斥。
- `src-tauri/src/runs/shutdown.rs`：权限拒绝、取消、宽限等待及强制清理。
- `src-tauri/src/settings/repository.rs`：设置读取、修订号、合并、备份和原子写入。
- `src-tauri/src/settings/watcher.rs`：设置文件监听与防抖。
- `src-tauri/src/preferences/repository.rs`：手动项目和非敏感 UI 偏好 JSON。
- `src-tauri/src/sessions/delete.rs`：精确删除计划和系统废纸篓操作。
- `src-tauri/src/diagnostics/redact.rs`：递归脱敏。
- `src-tauri/src/commands/*.rs`：CLI、会话、运行、设置和偏好的窄 Tauri 命令。
- `src-tauri/tests/*.rs`：Rust 集成测试与 fake bridge 测试。

### Vue 前端

- `src/main.ts`、`src/App.vue`：应用启动和两栏外壳。
- `src/domain/models.ts`、`src/domain/events.ts`：前端 DTO 和事件联合类型。
- `src/services/backend.ts`：全部 Tauri command 的类型化封装。
- `src/services/run-events.ts`：单一事件订阅、sequence 过滤和路由。
- `src/stores/workspace.ts`：项目、会话、选中状态和目录刷新。
- `src/stores/runs.ts`：各 session 的流式消息、权限和生命周期。
- `src/stores/settings.ts`：设置快照、dirty/conflict 和保存状态。
- `src/components/sidebar/*`：项目与会话导航、菜单和状态。
- `src/components/conversation/*`：消息、Markdown、工具卡片、交互卡片、输入框。
- `src/components/settings/SettingsView.vue`：三字段设置和 CLI 状态。
- `src/components/common/*`：空状态、错误、确认框和状态标识。
- `src/styles/tokens.css`、`src/styles/app.css`：Claude 深色主题和全局布局。
- `src/**/*.spec.ts`：组件、store、service 和协议测试。

### 端到端、文档与产物

- `tests/fixtures/bridge/*.jsonl`：确定性的 Bridge/SDK 事件样本。
- `tests/fixtures/claude-home/**`：项目、会话、损坏 JSONL 和设置文件样本。
- `tests/e2e/app.spec.ts`、`playwright.config.ts`：模拟 Tauri IPC 的核心界面闭环。
- `README.md`：安装前提、开发、构建、未签名警告和隐私边界。
- `docs/testing/platform-smoke.md`：与新最小闭环一致的 macOS/Windows 人工验收清单。
- `artifacts/`：最终 DMG 和 NSIS 安装程序；不提交 Git。

---

### Task 1: 从空目录建立可验证的 Tauri/Vue/Bridge 工程

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/App.spec.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Create: `bridge/package.json`
- Create: `bridge/tsconfig.json`
- Create: `bridge/vitest.config.ts`
- Create: `bridge/src/main.ts`
- Create: `bridge/src/main.spec.ts`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: 中文规格和 Global Constraints。
- Produces: `claude_desk_lib::run()`、Vue `#app`、Bridge `main(argv)`，以及 `test/typecheck/build/verify` 命令。

- [ ] **Step 1: 建立或确认 Git 执行环境**

Run:

```bash
if test -d .git; then git status --short; else git init -b main; fi
git switch -c codex/claude-desk-rebuild
```

Expected: 当前分支为 `codex/claude-desk-rebuild`。如果分支已存在，改用 `git switch codex/claude-desk-rebuild`，不得删除已有分支。

- [ ] **Step 2: 验证构建工具链**

Run:

```bash
node --version
pnpm --version
bun --version
rustc --version
cargo --version
```

Expected: Node `>=22`、pnpm `>=11`、Bun `>=1.3`、Rust/Cargo `>=1.88`。缺少系统工具时单独请求安装授权，不把系统安装藏进项目脚本。

- [ ] **Step 3: 先写失败的前端和 Bridge 冒烟测试**

```ts
// src/App.spec.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'

it('显示 Claude Desk 双栏外壳', () => {
  const wrapper = mount(App)
  expect(wrapper.get('[data-testid="app-shell"]')).toBeTruthy()
  expect(wrapper.text()).toContain('Claude Desk')
})
```

```ts
// bridge/src/main.spec.ts
import { describe, expect, it } from 'vitest'
import { parseMode } from './main'

it('只接受 handshake、catalog、run', () => {
  expect(parseMode(['handshake'])).toBe('handshake')
  expect(() => parseMode(['unknown'])).toThrow('unsupported bridge mode')
})
```

- [ ] **Step 4: 创建 package 配置并证明测试失败**

根 `package.json` 固定核心版本：

```json
{
  "name": "claude-desk",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit",
    "build": "vue-tsc --noEmit && vite build",
    "bridge:test": "pnpm --dir bridge test",
    "bridge:build": "node scripts/build-sidecar.mjs",
    "tauri": "tauri",
    "verify": "pnpm test && pnpm bridge:test && pnpm typecheck && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml"
  },
  "dependencies": {
    "@tauri-apps/api": "2.11.1",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "dompurify": "^3.2.0",
    "lucide-vue-next": "0.540.0",
    "markdown-it": "15.0.1",
    "pinia": "4.0.3",
    "vue": "3.5.42"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.11.4",
    "@vitejs/plugin-vue": "^6.0.0",
    "@vue/test-utils": "2.4.6",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vitest": "5.0.0",
    "vue-tsc": "3.3.11"
  }
}
```

`src-tauri/Cargo.toml` 固定为：

```toml
[package]
name = "claude-desk"
version = "0.1.0"
edition = "2021"
rust-version = "1.88"

[lib]
name = "claude_desk_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["fs", "io-util", "macros", "process", "rt-multi-thread", "sync", "time"] }
semver = "1"
which = "8"
dirs = "6"
notify = "8"
sha2 = "0.10"
hex = "0.4"
uuid = { version = "1", features = ["serde", "v4"] }
parking_lot = "0.12"
trash = "5"

[dev-dependencies]
tempfile = "3"
```

Bridge `package.json` 固定：

```json
{
  "name": "@claude-desk/bridge",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@anthropic-ai/claude-agent-sdk": "0.3.266" },
  "devDependencies": { "typescript": "7.0.2", "vitest": "5.0.0" }
}
```

Run:

```bash
pnpm install
pnpm test src/App.spec.ts
pnpm bridge:test
```

Expected: 两组测试因实现文件缺失或导出缺失而 FAIL。

- [ ] **Step 5: 实现最小外壳和 Bridge 模式解析**

```vue
<!-- src/App.vue -->
<template>
  <main data-testid="app-shell" class="app-shell">
    <aside class="sidebar"><span class="brand-mark">✦</span> Claude Desk</aside>
    <section class="workspace">选择项目以开始</section>
  </main>
</template>
```

```ts
// bridge/src/main.ts
export type BridgeMode = 'handshake' | 'catalog' | 'run'

export function parseMode(argv: string[]): BridgeMode {
  const mode = argv[0]
  if (mode === 'handshake' || mode === 'catalog' || mode === 'run') return mode
  throw new Error(`unsupported bridge mode: ${mode ?? '<missing>'}`)
}
```

Rust 入口固定为：

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("运行 Claude Desk 失败");
}
```

`capabilities/default.json` 只授予 core window 和 dialog open；不得包含 shell execute/spawn 权限。

- [ ] **Step 6: 验证三套工程表面**

Run:

```bash
pnpm test src/App.spec.ts
pnpm bridge:test
pnpm typecheck
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 全部 exit 0。

- [ ] **Step 7: 提交脚手架**

```bash
git add .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml index.html tsconfig*.json vite.config.ts src bridge src-tauri
git commit -m "chore: scaffold Claude Desk rebuild"
```

### Task 2: 定义跨进程领域协议和脱敏边界

**Files:**
- Create: `bridge/src/protocol.ts`
- Create: `bridge/src/protocol.spec.ts`
- Create: `src-tauri/src/domain.rs`
- Create: `src-tauri/src/bridge/mod.rs`
- Create: `src-tauri/src/bridge/protocol.rs`
- Create: `src-tauri/src/diagnostics/mod.rs`
- Create: `src-tauri/src/diagnostics/redact.rs`
- Create: `src-tauri/tests/protocol_contract.rs`
- Create: `src/domain/models.ts`
- Create: `src/domain/events.ts`
- Create: `src/domain/events.spec.ts`

**Interfaces:**
- Consumes: 无运行时接口。
- Produces: `BridgeRequest`、`BridgeFrame`、`RunEventEnvelope`、`SessionSummary`、`SettingsSnapshot`、`redact_json(Value) -> Value`。

- [ ] **Step 1: 写失败的 TypeScript 协议测试**

```ts
import { describe, expect, it } from 'vitest'
import { isBridgeRequest } from './protocol'

it('拒绝未知协议版本和空 runId', () => {
  expect(isBridgeRequest({ v: 2, type: 'run.start', runId: 'r1' })).toBe(false)
  expect(isBridgeRequest({ v: 1, type: 'run.start', runId: '' })).toBe(false)
})
```

- [ ] **Step 2: 写失败的 Rust 协议与脱敏测试**

```rust
#[test]
fn redacts_nested_secrets() {
    let value = serde_json::json!({"env":{"ANTHROPIC_AUTH_TOKEN":"secret"},"message":"ok"});
    assert_eq!(redact_json(value)["env"]["ANTHROPIC_AUTH_TOKEN"], "[REDACTED]");
}
```

Run: `pnpm bridge:test && cargo test --manifest-path src-tauri/Cargo.toml protocol_contract`

Expected: FAIL，缺少类型和实现。

- [ ] **Step 3: 固定 Bridge 协议联合类型**

```ts
export type BridgeRequest =
  | { v: 1; type: 'handshake'; requestId: string; claudePath: string }
  | { v: 1; type: 'catalog.list'; requestId: string; dir?: string }
  | { v: 1; type: 'catalog.messages'; requestId: string; sessionId: string; dir?: string }
  | { v: 1; type: 'catalog.rename'; requestId: string; sessionId: string; title: string; dir?: string }
  | { v: 1; type: 'run.start'; runId: string; projectPath: string; prompt: string; resumeSessionId?: string }
  | { v: 1; type: 'run.stop'; runId: string }
  | { v: 1; type: 'interaction.resolve'; runId: string; requestId: string; resolution: InteractionResolution }

export type InteractionResolution =
  | { kind: 'allow'; updatedInput: Record<string, unknown> }
  | { kind: 'deny'; message: string }
  | { kind: 'answers'; answers: Record<string, string> }

export type RunEvent =
  | { kind: 'initialized'; sessionId: string; model?: string }
  | { kind: 'assistant_delta'; messageId: string; text: string }
  | { kind: 'assistant_message'; messageId: string; markdown: string }
  | { kind: 'tool_started'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_finished'; toolUseId: string; output: unknown; isError: boolean }
  | { kind: 'permission_requested'; requestId: string; toolName: string; input: Record<string, unknown> }
  | { kind: 'question_requested'; requestId: string; questions: UserQuestion[] }
  | { kind: 'completed'; sessionId: string }
  | { kind: 'failed'; code: string; message: string; retryable: boolean }
  | { kind: 'cancelled' }

export interface RunEventEnvelope {
  v: 1
  runId: string
  sessionId?: string
  sequence: number
  event: RunEvent
}
```

在 Rust 和前端中建立相同字段名、snake/camel 序列化规则及 `RunStatus = idle|running|awaiting_permission|completed|failed|interrupted`。

- [ ] **Step 4: 实现递归脱敏**

`redact_json` 对大小写不敏感的 `token`、`authorization`、`api_key`、`apiKey`、`secret`、`password` 键替换为 `[REDACTED]`，数组递归处理，其他值不变。字符串日志再用正则遮盖 `Bearer <value>`。

```rust
pub fn is_secret_key(key: &str) -> bool {
    matches!(key.to_ascii_lowercase().as_str(),
        "anthropic_auth_token" | "authorization" | "api_key" | "apikey" | "secret" | "password")
}
```

- [ ] **Step 5: 运行协议测试和类型检查**

Run:

```bash
pnpm bridge:test
pnpm test src/domain/events.spec.ts
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml protocol_contract
```

Expected: PASS；错误快照中不出现测试 secret。

- [ ] **Step 6: 提交协议边界**

```bash
git add bridge/src/protocol* src/domain src-tauri/src/domain.rs src-tauri/src/bridge src-tauri/src/diagnostics src-tauri/tests/protocol_contract.rs
git commit -m "feat: define versioned desktop bridge protocol"
```

### Task 3: 实现 Claude CLI 发现、版本验证和 Bridge 握手

**Files:**
- Create: `src-tauri/src/cli/mod.rs`
- Create: `src-tauri/src/cli/locator.rs`
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/cli.rs`
- Create: `src-tauri/tests/cli_locator.rs`
- Modify: `bridge/src/main.ts`
- Modify: `bridge/src/main.spec.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `locate_claude(overrides: &[PathBuf]) -> Result<CliStatus, AppError>`、Tauri `get_cli_status()`、`redetect_cli()`、Bridge handshake 响应 `{bridgeVersion, claudePath}`。

- [ ] **Step 1: 写 locator 失败测试**

```rust
#[tokio::test]
async fn rejects_an_old_claude_version() {
    let fake = FakeExecutable::printing("2.1.100 (Claude Code)");
    let error = verify_candidate(fake.path()).await.unwrap_err();
    assert_eq!(error.code(), "CLAUDE_VERSION_UNSUPPORTED");
}
```

同时覆盖路径含空格、命令超时、非零退出、Windows `.exe/.cmd` 候选和 GUI PATH 缺失。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test cli_locator`

Expected: FAIL，`verify_candidate` 不存在。

- [ ] **Step 3: 实现明确的候选顺序和版本解析**

候选顺序固定为：显式测试覆盖 → 当前进程 PATH → macOS `/opt/homebrew/bin/claude`、`/usr/local/bin/claude`、`~/.local/bin/claude` → Windows `%APPDATA%\npm\claude.cmd`、`%LOCALAPPDATA%\Programs\claude\claude.exe`。每个候选执行 `--version`，超时 3 秒，接受 `>=2.1.223`。

```rust
#[derive(Debug, Serialize, Clone)]
pub struct CliStatus {
    pub state: CliState,
    pub executable: Option<PathBuf>,
    pub version: Option<String>,
    pub message: Option<String>,
}
```

- [ ] **Step 4: 实现 Bridge handshake**

`handshake` 从 stdin 读取一条 `BridgeRequest`，校验文件存在，stdout 只写一条 JSONL：

```ts
{ v: 1, type: 'response', requestId, ok: true, data: { bridgeVersion: 1, claudePath } }
```

stderr 仅输出脱敏诊断；绝不把环境变量 dump 到日志。

- [ ] **Step 5: 连接 Tauri 命令并验证**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test cli_locator
pnpm bridge:test
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS；旧版本、缺失和超时返回稳定错误码。

- [ ] **Step 6: 提交 CLI 检测**

```bash
git add src-tauri/src/cli src-tauri/src/error.rs src-tauri/src/commands src-tauri/src/lib.rs src-tauri/tests/cli_locator.rs bridge/src/main*
git commit -m "feat: detect and verify local Claude CLI"
```

### Task 4: 建立会话目录、消息读取、重命名和手动项目偏好

**Files:**
- Create: `bridge/src/agent-adapter.ts`
- Create: `bridge/src/catalog.ts`
- Create: `bridge/src/catalog.spec.ts`
- Create: `bridge/src/jsonl.ts`
- Create: `bridge/src/jsonl.spec.ts`
- Create: `src-tauri/src/bridge/catalog.rs`
- Create: `src-tauri/src/preferences/mod.rs`
- Create: `src-tauri/src/preferences/repository.rs`
- Create: `src-tauri/src/commands/sessions.rs`
- Create: `src-tauri/src/commands/preferences.rs`
- Create: `src-tauri/tests/catalog_bridge.rs`
- Create: `src-tauri/tests/preferences_repository.rs`
- Create: `tests/fixtures/claude-home/projects/sample/session-1.jsonl`

**Interfaces:**
- Consumes: Bridge protocol、已验证 Claude 路径。
- Produces: `CatalogService.list(dir?)`、`messages(sessionId, dir?)`、`rename(sessionId,title,dir?)`、Tauri `list_workspace()`、`get_session_messages()`、`rename_session()`、`add_manual_project()`。

- [ ] **Step 1: 写失败的 Bridge 目录测试**

```ts
it('按 cwd 分组并按最后活动时间倒序返回会话', async () => {
  const adapter = fakeAdapter([
    { sessionId: 's1', summary: 'A', lastModified: 10, cwd: '/work/a' },
    { sessionId: 's2', summary: 'B', lastModified: 20, cwd: '/work/b' }
  ])
  const result = await new CatalogService(adapter).list()
  expect(result.map((x) => x.sessionId)).toEqual(['s2', 's1'])
})
```

覆盖 `cwd` 缺失、损坏消息 payload、空标题、rename 空白标题和 SDK 未知字段。

- [ ] **Step 2: 证明目录测试失败**

Run: `pnpm bridge:test -- catalog.spec.ts jsonl.spec.ts`

Expected: FAIL，目录服务不存在。

- [ ] **Step 3: 实现官方 SDK adapter**

```ts
export interface AgentAdapter {
  listSessions(options?: { dir?: string }): Promise<SDKSessionInfo[]>
  getSessionMessages(sessionId: string, options?: { dir?: string }): Promise<SessionMessage[]>
  renameSession(sessionId: string, title: string, options?: { dir?: string }): Promise<void>
  query(args: QueryArgs): AsyncIterable<SDKMessage>
}
```

生产实现直接委托 `listSessions/getSessionMessages/renameSession/query`。目录 DTO 只保留 `sessionId/summary/lastModified/customTitle/firstPrompt/gitBranch/cwd/createdAt`；消息转换为稳定的文本块和工具块，不把 raw SDK 对象直接发给 Vue。

- [ ] **Step 4: 实现 Rust 目录 sidecar 调用和偏好存储**

`AppPreferences` 使用 app config 目录下 `preferences.json`：

```rust
#[derive(Default, Serialize, Deserialize)]
pub struct AppPreferences {
    pub manual_project_paths: Vec<PathBuf>,
    pub expanded_project_paths: Vec<PathBuf>,
    pub last_session_id: Option<String>,
}
```

写入使用同目录临时文件 + rename。`list_workspace()` 合并 SDK 会话的 `cwd` 与存在且为目录的手动路径，按最后活动时间排序，空项目也必须显示。

- [ ] **Step 5: 验证目录和偏好**

Run:

```bash
pnpm bridge:test -- catalog.spec.ts jsonl.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml --test catalog_bridge
cargo test --manifest-path src-tauri/Cargo.toml --test preferences_repository
```

Expected: PASS；未知 transcript 行被跳过且原文件不变。

- [ ] **Step 6: 提交会话目录**

```bash
git add bridge/src src-tauri/src/bridge/catalog.rs src-tauri/src/preferences src-tauri/src/commands src-tauri/tests tests/fixtures/claude-home
git commit -m "feat: load Claude projects and sessions"
```

### Task 5: 实现 settings.json 安全读取、冲突检测、写入和监听

**Files:**
- Create: `src-tauri/src/settings/mod.rs`
- Create: `src-tauri/src/settings/repository.rs`
- Create: `src-tauri/src/settings/watcher.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/tests/settings_repository.rs`
- Create: `src-tauri/tests/settings_watcher.rs`
- Create: `tests/fixtures/claude-home/settings.json`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `SettingsRepository::read() -> SettingsSnapshot`、`save(SettingsPatch) -> SettingsSnapshot`、Tauri `get_settings()`、`reveal_auth_token()`、`save_settings()`、事件 `settings://changed`。

- [ ] **Step 1: 写失败的合并和冲突测试**

```rust
#[test]
fn saves_three_env_values_without_losing_other_json() {
    let original = json!({"permissions":{"allow":["Read"]},"env":{"EXTRA":"keep"}});
    let saved = merge_settings(original, patch("token", "https://gateway", "model-a"));
    assert_eq!(saved["permissions"]["allow"][0], "Read");
    assert_eq!(saved["env"]["EXTRA"], "keep");
    assert_eq!(saved["env"]["ANTHROPIC_MODEL"], "model-a");
}
```

另写：无文件、无效 JSON、空值删除单键、revision 不匹配、备份权限、Token 不在快照中的测试。

- [ ] **Step 2: 运行并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test settings_repository`

Expected: FAIL，repository 不存在。

- [ ] **Step 3: 实现无明文 Token 的 DTO**

```rust
pub struct SettingsSnapshot {
    pub path: PathBuf,
    pub revision: String,
    pub auth_token_configured: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

pub enum SecretUpdate { Keep, Set(String), Remove }

pub struct SettingsPatch {
    pub expected_revision: String,
    pub auth_token: SecretUpdate,
    pub base_url: Option<String>,
    pub model: Option<String>,
}
```

revision 使用原始文件字节的 SHA-256。`reveal_auth_token()` 是唯一返回明文的命令，结果不缓存；保存命令接收 `SecretUpdate`，绝不回传 Token。

- [ ] **Step 4: 实现原子写入和 watcher**

保存流程严格为：重新读取 → revision 比较 → JSON 合并 → 创建 `settings.json.backup-<UTC>` → 同目录临时文件 → flush/sync → rename → 重新读取验证。Unix 新文件权限 `0600`。Notify watcher 防抖 250 ms，只发送不含 Token 的 `SettingsSnapshot`。

- [ ] **Step 5: 验证设置安全性**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test settings_repository
cargo test --manifest-path src-tauri/Cargo.toml --test settings_watcher
cargo test --manifest-path src-tauri/Cargo.toml diagnostics
```

Expected: PASS；测试输出与快照中不存在 `token-for-test`。

- [ ] **Step 6: 提交设置同步**

```bash
git add src-tauri/src/settings src-tauri/src/commands/settings.rs src-tauri/src/lib.rs src-tauri/tests/settings_* tests/fixtures/claude-home/settings.json
git commit -m "feat: synchronize Claude user settings safely"
```

### Task 6: 实现精确、可恢复的会话删除

**Files:**
- Create: `src-tauri/src/sessions/mod.rs`
- Create: `src-tauri/src/sessions/delete.rs`
- Create: `src-tauri/src/commands/session_delete.rs`
- Create: `src-tauri/tests/session_delete.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `resolve_delete_plan(claude_home, session_id) -> DeletePlan`、`execute_delete_plan(plan) -> DeleteResult`、Tauri `preview_session_delete()` 和 `delete_session()`。

- [ ] **Step 1: 写路径逃逸和精确匹配失败测试**

```rust
#[test]
fn never_deletes_prefix_or_parent_matches() {
    let plan = resolve_delete_plan(home.path(), "abc").unwrap();
    assert!(plan.targets.iter().all(|p| p.file_name().unwrap() == "abc.jsonl" || p.file_name().unwrap() == "abc"));
    assert!(!plan.targets.iter().any(|p| p.ends_with("abc-other.jsonl")));
}
```

覆盖 `../`、非 UUID、符号链接逃逸、活动会话、无目标和部分 trash 失败。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test session_delete`

Expected: FAIL。

- [ ] **Step 3: 实现预览与执行两阶段接口**

`DeletePlan` 包含随机 `plan_id`、session ID、标题、项目路径、最后活动时间、规范化目标列表和 60 秒过期时间。执行必须使用服务端缓存的 plan，不接受前端再次传路径。目标限定为：

```text
~/.claude/projects/**/<session-id>.jsonl
~/.claude/projects/**/<session-id>/
~/.claude/file-history/<session-id>/
~/.claude/session-env/<session-id>/
~/.claude/tasks/<session-id>/
```

每个目标调用 `trash::delete`；失败逐项返回，完成后重新获取目录。

- [ ] **Step 4: 验证删除边界**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test session_delete`

Expected: PASS；项目源码和其他 session fixture 保持存在。

- [ ] **Step 5: 提交可恢复删除**

```bash
git add src-tauri/src/sessions src-tauri/src/commands src-tauri/src/lib.rs src-tauri/tests/session_delete.rs
git commit -m "feat: add recoverable Claude session deletion"
```

### Task 7: 实现 Agent Bridge 单轮次流式执行与交互等待

**Files:**
- Create: `bridge/src/normalize.ts`
- Create: `bridge/src/normalize.spec.ts`
- Create: `bridge/src/run-worker.ts`
- Create: `bridge/src/run-worker.spec.ts`
- Create: `tests/fixtures/bridge/run-success.jsonl`
- Create: `tests/fixtures/bridge/run-permission.jsonl`
- Modify: `bridge/src/agent-adapter.ts`
- Modify: `bridge/src/main.ts`

**Interfaces:**
- Consumes: `AgentAdapter.query()`、Bridge protocol。
- Produces: `runWorker(start, io, adapter) -> Promise<void>`，按 sequence 输出 `RunEventEnvelope`。

- [ ] **Step 1: 写失败的事件标准化测试**

```ts
it('把 init、文本、工具和 result 转成稳定顺序事件', () => {
  const events = normalizeSdkMessages(fixture('run-success.jsonl'))
  expect(events.map((event) => event.kind)).toEqual([
    'initialized', 'assistant_delta', 'assistant_message',
    'tool_started', 'tool_finished', 'completed'
  ])
})
```

覆盖未知 SDK 消息、错误 result、重复 message ID 和 partial delta。

- [ ] **Step 2: 写失败的权限与问题等待测试**

```ts
it('权限断开时默认拒绝', async () => {
  const io = fakeIoThatDisconnects()
  const result = await createInteractionBroker(io).ask('Write', { file_path: '/tmp/a' }, abortSignal)
  expect(result).toEqual({ behavior: 'deny', message: 'Claude Desk disconnected before approval' })
})
```

另测 Allow 原样返回 `updatedInput`、Deny 消息、60 分钟超时、Stop 取消，以及 `AskUserQuestion` answers 映射。

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm bridge:test -- normalize.spec.ts run-worker.spec.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 query 参数和生命周期**

```ts
const options = {
  cwd: start.projectPath,
  pathToClaudeCodeExecutable: claudePath,
  permissionMode: 'default' as const,
  canUseTool: broker.canUseTool,
  includePartialMessages: true,
  settingSources: ['user', 'project', 'local'] as const,
  abortController,
  persistSession: true,
  ...(start.resumeSessionId ? { resume: start.resumeSessionId } : {})
}
```

不得传 `model`。prompt 使用字符串输入；worker stdin 保持用于 Bridge 自身的 `interaction.resolve/run.stop`，Bridge 将决议交给 pending Promise。所有 stdout 行只能是协议 JSON，诊断写 stderr 且先脱敏。

- [ ] **Step 5: 实现 AskUserQuestion 特殊映射**

当 `toolName === 'AskUserQuestion'` 时发送 `question_requested`；收到 answers 后返回：

```ts
{ behavior: 'allow', updatedInput: { questions: input.questions, answers } }
```

普通权限允许必须显式返回原始 `input`，不得返回空对象。

- [ ] **Step 6: 验证 worker**

Run:

```bash
pnpm bridge:test -- normalize.spec.ts run-worker.spec.ts
pnpm --dir bridge typecheck
```

Expected: PASS；每个 run 从 sequence 1 单调递增，停止后只产生一次 `cancelled`。

- [ ] **Step 7: 提交流式 Bridge**

```bash
git add bridge/src tests/fixtures/bridge
git commit -m "feat: stream Claude turns through agent bridge"
```

### Task 8: 实现 Rust worker 监管、并行注册表和安全退出

**Files:**
- Create: `src-tauri/src/bridge/worker.rs`
- Create: `src-tauri/src/runs/mod.rs`
- Create: `src-tauri/src/runs/registry.rs`
- Create: `src-tauri/src/runs/shutdown.rs`
- Create: `src-tauri/src/commands/runs.rs`
- Create: `src-tauri/tests/run_registry.rs`
- Create: `src-tauri/tests/worker_supervisor.rs`
- Create: `src-tauri/tests/shutdown.rs`
- Create: `tests/fixtures/fake-bridge.mjs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Tauri `start_run()`、`stop_run()`、`resolve_interaction()`、`active_runs()`；事件通道 `run://event`；`RunRegistry::claim_session/release_session`。

- [ ] **Step 1: 写失败的同会话互斥与跨会话并行测试**

```rust
#[tokio::test]
async fn blocks_same_session_but_allows_different_sessions() {
    let registry = RunRegistry::default();
    registry.claim_session("r1", "s1").unwrap();
    assert_eq!(registry.claim_session("r2", "s1").unwrap_err().code(), "SESSION_BUSY");
    assert!(registry.claim_session("r3", "s2").is_ok());
}
```

- [ ] **Step 2: 写失败的 worker 崩溃与退出清理测试**

Fake bridge 接收 `run.start` 后可按环境变量选择 stream、permission、hang、crash。测试确认 crash 只中断所属 run；shutdown 先发 deny，再 stop，2 秒后强制结束。

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test run_registry
cargo test --manifest-path src-tauri/Cargo.toml --test worker_supervisor
cargo test --manifest-path src-tauri/Cargo.toml --test shutdown
```

Expected: FAIL。

- [ ] **Step 3: 实现 worker 启动和事件校验**

Rust 通过 Tauri sidecar 资源定位 Bridge，不接受前端传入可执行路径。stdin 写一行 `run.start`。`tauri-plugin-shell` 的 stdout 事件可能只包含半行或多行，所以 `worker.rs` 必须维护 `Vec<u8>` 缓冲区：收到 `CommandEvent::Stdout` 后追加字节，以 `b'\n'` 切分完整 JSONL 行，把末尾半行保留到下一事件；每个完整行先做 1 MiB 长度限制，再交给 `serde_json::from_slice::<BridgeEvent>()`。每行验证 `v/runId/sequence`，sequence 回退或 runId 不匹配时记录脱敏诊断并丢弃。

实现时使用实际 API：

```rust
pub struct ActiveRun {
    pub run_id: String,
    pub session_id: Option<String>,
    pub project_path: PathBuf,
    pub child: BridgeChild,
    pub pending_requests: HashSet<String>,
    pub last_sequence: u64,
}
```

- [ ] **Step 4: 实现命令校验和状态转换**

`start_run` 规范化项目目录、拒绝空 prompt、检查 CLI ready、检查同 session 互斥，然后启动 worker。`resolve_interaction` 必须同时匹配 run ID 与 pending request ID。`stop_run` 幂等。terminal event 后释放 session claim 并刷新目录。

- [ ] **Step 5: 实现关闭确认后清理**

窗口 close-request 在存在活动 run 时阻止关闭并发送 `app://close-requested`。用户确认后调用 `shutdown_all`：pending 决议全部 Deny → 每个 worker 发送 Stop → 等待 2 秒 → 终止残留 worker 及其子进程树 → 允许窗口关闭。

- [ ] **Step 6: 验证监管和并行**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test run_registry
cargo test --manifest-path src-tauri/Cargo.toml --test worker_supervisor
cargo test --manifest-path src-tauri/Cargo.toml --test shutdown
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS；fake bridge 测试结束后不存在残留 PID。

- [ ] **Step 7: 提交运行时核心**

```bash
git add src-tauri/src/bridge/worker.rs src-tauri/src/runs src-tauri/src/commands/runs.rs src-tauri/src/lib.rs src-tauri/tests tests/fixtures/fake-bridge.mjs
git commit -m "feat: supervise parallel Claude session workers"
```

### Task 9: 建立前端类型化 IPC、事件路由和 Pinia 状态

**Files:**
- Create: `src/services/backend.ts`
- Create: `src/services/backend.spec.ts`
- Create: `src/services/run-events.ts`
- Create: `src/services/run-events.spec.ts`
- Create: `src/stores/workspace.ts`
- Create: `src/stores/workspace.spec.ts`
- Create: `src/stores/runs.ts`
- Create: `src/stores/runs.spec.ts`
- Create: `src/stores/settings.ts`
- Create: `src/stores/settings.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Tauri commands 和 `run://event/settings://changed/app://close-requested`。
- Produces: `useWorkspaceStore()`、`useRunsStore()`、`useSettingsStore()`，UI 组件只调用 store actions。

- [ ] **Step 1: 写失败的事件去重和切换不中断测试**

```ts
it('忽略旧 sequence 且切换选中会话不删除运行状态', () => {
  const store = useRunsStore()
  store.accept(envelope('r1', 2, { kind: 'assistant_delta', messageId: 'm1', text: 'B' }))
  store.accept(envelope('r1', 1, { kind: 'assistant_delta', messageId: 'm1', text: 'A' }))
  store.selectSession('s2')
  expect(store.byRunId.r1.messages[0].markdown).toBe('B')
})
```

另测临时会话与 init session ID 对账、permission pending、terminal 状态、settings dirty/conflict。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm test src/services src/stores`

Expected: FAIL。

- [ ] **Step 3: 实现单一后端接口**

```ts
export interface Backend {
  getCliStatus(): Promise<CliStatus>
  listWorkspace(): Promise<ProjectSummary[]>
  getSessionMessages(sessionId: string, dir?: string): Promise<ConversationItem[]>
  startRun(input: StartRunInput): Promise<{ runId: string }>
  stopRun(runId: string): Promise<void>
  resolveInteraction(input: ResolveInteractionInput): Promise<void>
  getSettings(): Promise<SettingsSnapshot>
  saveSettings(patch: SettingsPatch): Promise<SettingsSnapshot>
}
```

生产实现只使用 `invoke/listen`；测试通过 `setBackendForTests()` 注入 fake，不在组件中 mock 全局 Tauri。

- [ ] **Step 4: 实现 stores**

`workspace` 保存项目、会话和 selection；`runs` 以 run ID 保存临时流，并维护 `sessionToRun`; `settings` 维护 snapshot、draft、dirty、conflict。仅把 `manual_project_paths/expanded_project_paths/last_session_id` 发送后端持久化，Token 草稿永不进入 localStorage。

- [ ] **Step 5: 验证前端状态层**

Run:

```bash
pnpm test src/services src/stores
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交前端状态层**

```bash
git add src/main.ts src/services src/stores
git commit -m "feat: add typed desktop state and event routing"
```

### Task 10: 实现左侧项目与会话导航

**Files:**
- Create: `src/components/sidebar/AppSidebar.vue`
- Create: `src/components/sidebar/AppSidebar.spec.ts`
- Create: `src/components/sidebar/ProjectGroup.vue`
- Create: `src/components/sidebar/SessionRow.vue`
- Create: `src/components/sidebar/SessionMenu.vue`
- Create: `src/components/common/ConfirmDialog.vue`
- Create: `src/components/common/StatusDot.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: workspace/runs stores 和 Backend 的 add project、rename、delete preview/execute。
- Produces: 项目折叠树、新建会话、添加项目、打开、重命名和删除交互。

- [ ] **Step 1: 写失败的侧边栏行为测试**

```ts
it('按项目展示会话并保留运行状态', async () => {
  const wrapper = mountWithStores(AppSidebar, workspaceFixture())
  expect(wrapper.findAll('[data-testid="project-group"]')).toHaveLength(2)
  expect(wrapper.get('[data-session-id="s-running"]').attributes('data-status')).toBe('running')
})
```

另测文件夹选择取消、空项目、新建临时会话、重命名 trim、活动会话禁删、删除二次确认。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/components/sidebar`

Expected: FAIL。

- [ ] **Step 3: 实现两级导航与状态**

项目行显示名称和完整路径 tooltip；会话按 `lastModified` 降序；状态点映射 idle/运行/等待授权/完成/失败/中断。项目折叠状态通过 preferences action 持久化。新建会话先创建只存在于前端的 draft session，首次发送获得真实 session ID 后替换。

- [ ] **Step 4: 实现 rename/delete 流程**

Rename 只接受 trim 后 1–120 字符。Delete 先调用 `previewSessionDelete`，确认框展示服务端返回的标题、项目、时间和目标数量，再以 `planId` 执行；任何失败都刷新目录并展示逐项错误。

- [ ] **Step 5: 验证导航**

Run:

```bash
pnpm test src/components/sidebar
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交侧边栏**

```bash
git add src/App.vue src/components/sidebar src/components/common
git commit -m "feat: add project and session sidebar"
```

### Task 11: 实现流式对话、Markdown、工具和用户交互界面

**Files:**
- Create: `src/components/conversation/ConversationView.vue`
- Create: `src/components/conversation/ConversationView.spec.ts`
- Create: `src/components/conversation/MessageBubble.vue`
- Create: `src/components/conversation/MarkdownBody.vue`
- Create: `src/components/conversation/markdown.ts`
- Create: `src/components/conversation/markdown.spec.ts`
- Create: `src/components/conversation/ToolCard.vue`
- Create: `src/components/conversation/PermissionCard.vue`
- Create: `src/components/conversation/QuestionCard.vue`
- Create: `src/components/conversation/ComposerBox.vue`
- Create: `src/components/conversation/ComposerBox.spec.ts`
- Create: `src/components/common/InlineError.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: runs/workspace store actions。
- Produces: 完整会话主区域、发送、停止、重试、Allow/Deny 和 question answers。

- [ ] **Step 1: 写失败的 Markdown 安全测试**

```ts
it('保留代码块并移除脚本和事件属性', () => {
  const html = renderMarkdown('```ts\nconst x = 1\n```\n<img src=x onerror=alert(1)><script>x</script>')
  expect(html).toContain('const x = 1')
  expect(html).not.toContain('onerror')
  expect(html).not.toContain('<script')
})
```

- [ ] **Step 2: 写失败的发送、停止和权限测试**

```ts
it('运行中禁用重复发送但允许停止', async () => {
  const wrapper = mountComposer({ status: 'running' })
  expect(wrapper.get('[data-testid="send"]').attributes()).toHaveProperty('disabled')
  expect(wrapper.get('[data-testid="stop"]').attributes()).not.toHaveProperty('disabled')
})
```

另测 Allow 传回原 input、Deny 可附理由、问题单选/多选、错误重试保留 prompt、切换会话流不丢失。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test src/components/conversation`

Expected: FAIL。

- [ ] **Step 4: 实现消息和工具时间线**

Markdown 使用 `markdown-it` + `DOMPurify`；外部链接添加 `rel="noreferrer noopener"`。工具卡展示 toolName 和输入摘要，默认折叠大型内容；tool result 展示成功/失败。partial delta 合并到同一 message ID，最终 message 替换 partial，避免重复文本。

- [ ] **Step 5: 实现 composer 和交互卡片**

Enter 发送、Shift+Enter 换行；空白输入禁止发送。PermissionCard 一次点击后立即禁用，等待后端确认。QuestionCard 支持 1–4 题、单选/多选并把答案映射为 `{[question]: labels.join(', ')}`。停止调用当前 run ID；重试使用 store 保存的原 prompt，存在 session ID 时恢复该会话。

- [ ] **Step 6: 验证对话界面**

Run:

```bash
pnpm test src/components/conversation
pnpm typecheck
```

Expected: PASS；恶意 Markdown fixture 不产生可执行 HTML。

- [ ] **Step 7: 提交对话闭环**

```bash
git add src/App.vue src/components/conversation src/components/common/InlineError.vue
git commit -m "feat: add streaming conversation and approvals"
```

### Task 12: 实现设置页、文件冲突和 CLI 就绪状态

**Files:**
- Create: `src/components/settings/SettingsView.vue`
- Create: `src/components/settings/SettingsView.spec.ts`
- Create: `src/components/common/SetupState.vue`
- Create: `src/components/common/SetupState.spec.ts`
- Modify: `src/App.vue`
- Modify: `src/stores/settings.ts`

**Interfaces:**
- Consumes: `getSettings/revealAuthToken/saveSettings/getCliStatus/redetectCli` 和 `settings://changed`。
- Produces: 三字段设置、Token 临时显示、冲突提示和 CLI 安装/登录引导。

- [ ] **Step 1: 写失败的敏感字段和冲突测试**

```ts
it('初始状态只显示占位符而不加载明文 Token', async () => {
  const wrapper = mountSettings({ authTokenConfigured: true })
  expect(wrapper.get('input[name="authToken"]').element.value).toBe('')
  expect(wrapper.text()).toContain('已配置')
})
```

另测点击显示才调用 reveal、隐藏后清空内存值、base URL 非 http(s) 报错、外部变化 dirty 时不覆盖、revision conflict 提供重新加载。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/components/settings src/components/common/SetupState.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 实现设置表单**

Token 提交状态明确为 Keep/Set/Remove；掩码占位符绝不作为值提交。`ANTHROPIC_MODEL` 允许任意 trim 后非空字符串；Base URL 空值表示删除，否则必须为 `http:` 或 `https:`。保存成功后清空 Token 明文和 dirty 状态。

- [ ] **Step 4: 实现 CLI setup state**

状态包括 checking/ready/missing/unsupported/error。missing 显示官方安装文档链接和重新检测；unsupported 显示当前版本与最低版本 `2.1.223`；App 不执行安装命令。ready 状态在侧边栏底部显示版本和路径 tooltip。

- [ ] **Step 5: 验证设置与 setup**

Run:

```bash
pnpm test src/components/settings src/components/common/SetupState.spec.ts src/stores/settings.spec.ts
pnpm typecheck
```

Expected: PASS；测试 wrapper 与快照中没有 fixture Token。

- [ ] **Step 6: 提交设置界面**

```bash
git add src/App.vue src/components/settings src/components/common/SetupState* src/stores/settings.ts
git commit -m "feat: add Claude settings synchronization UI"
```

### Task 13: 完成 Claude 深色主题、键盘可用性和退出确认

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/app.css`
- Modify: `src/App.vue`
- Modify: `src/App.spec.ts`
- Create: `src/components/common/CloseConfirmDialog.vue`
- Create: `src/components/common/CloseConfirmDialog.spec.ts`

**Interfaces:**
- Consumes: 现有组件和 `app://close-requested`。
- Produces: 唯一深色 Claude 主题、响应式最小尺寸、焦点样式和退出确认。

- [ ] **Step 1: 写失败的主题与键盘测试**

```ts
it('所有主要操作可通过键盘聚焦且退出可取消', async () => {
  const wrapper = mountAppWithActiveRuns(2)
  await emitCloseRequested()
  expect(wrapper.get('[role="dialog"]').text()).toContain('2 个会话仍在运行')
  await wrapper.get('[data-testid="cancel-close"]').trigger('click')
  expect(fakeBackend.confirmShutdown).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/App.spec.ts src/components/common/CloseConfirmDialog.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 固定设计 Token**

```css
:root {
  color-scheme: dark;
  --bg-root: #0b0b0a;
  --bg-sidebar: #141310;
  --bg-raised: #1d1b18;
  --bg-hover: #292620;
  --border: #34302a;
  --text-primary: #f4f0e8;
  --text-secondary: #aaa39a;
  --accent: #f97316;
  --accent-hover: #fb8b32;
  --success: #65a66f;
  --warning: #d9a441;
  --danger: #d46262;
  --focus: #ffb36b;
}
```

侧边栏宽 280px；窗口最小 960×640；减少动画偏好下关闭 pulse/transition；所有按钮提供 `:focus-visible`；颜色不是状态的唯一表达方式。

- [ ] **Step 4: 实现退出确认**

取消仅关闭对话框；确认调用 `confirmShutdown()`，等待成功后才允许窗口退出；失败时保留对话框并显示错误，禁止假装已经清理。

- [ ] **Step 5: 验证视觉基础和构建**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS，Vite 无 CSS/模板错误。

- [ ] **Step 6: 提交最终界面外壳**

```bash
git add src/App.vue src/App.spec.ts src/components/common/CloseConfirmDialog* src/styles
git commit -m "feat: finish Claude dark desktop experience"
```

### Task 14: 加入 fake CLI/Bridge 集成与浏览器级闭环测试

**Files:**
- Create: `tests/fixtures/fake-claude.mjs`
- Create: `tests/fixtures/fake-bridge.mjs`
- Create: `src-tauri/tests/full_loop.rs`
- Create: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/fake-backend.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `bridge/src/agent-adapter.ts`

**Interfaces:**
- Consumes: 全部后端命令、Bridge 协议和 Vue stores。
- Produces: 不使用真实凭据和额度的完整自动化验证入口 `pnpm test:e2e` 与 Rust `full_loop`。

- [ ] **Step 1: 写失败的 Rust 完整闭环测试**

```rust
#[tokio::test]
async fn new_resume_permission_parallel_and_stop_complete() {
    let harness = Harness::with_fake_claude().await;
    let first = harness.start("/project-a", "STREAM").await;
    let second = harness.start("/project-b", "WAIT_PERMISSION").await;
    harness.allow(second.run_id(), "req-1").await;
    harness.stop(first.run_id()).await;
    assert_eq!(harness.status(first.run_id()), RunStatus::Interrupted);
    assert_eq!(harness.status(second.run_id()), RunStatus::Completed);
}
```

- [ ] **Step 2: 实现确定性 fake CLI、fake Bridge 和 adapter 注入**

`fake-claude.mjs` 接受 `--version` 并返回 `2.1.266 (Claude Code)`，并提供可选慢退出模式验证取消与清理。完整的 Bridge/Rust 自动化闭环不伪造 Agent SDK 未公开的 CLI 控制协议，而是在 Bridge 进程中通过依赖注入使用 `FakeAgentAdapter`，根据 prompt `STREAM/WAIT_PERMISSION/ASK/CRASH/HANG` 产生固定的 assistant/tool/permission/question/result fixture。`fake-bridge.mjs` 模拟 JSONL 进程边界、半行 stdout、损坏事件和异常退出；Rust worker 测试只在 `#[cfg(test)]` 下允许注入它的绝对路径。真实 SDK adapter 另有一条默认跳过的兼容性测试，仅当 `CLAUDE_DESK_REAL_CLI_TEST=1` 时调用本机 Agent SDK + Claude CLI 并验证 init/result；默认 CI 不访问网络。

- [ ] **Step 3: 写浏览器级失败测试**

```ts
test('完成项目到设置的最小闭环', async ({ page }) => {
  await page.goto('/')
  await page.getByText('项目 A').click()
  await page.getByRole('button', { name: '新建会话' }).click()
  await page.getByRole('textbox').fill('hello')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('流式回复完成')).toBeVisible()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByLabel('ANTHROPIC_MODEL')).toBeVisible()
})
```

- [ ] **Step 4: 实现 E2E fake backend 注入**

只在 `VITE_FAKE_BACKEND=1` 时注入 `tests/e2e/fake-backend.ts`；生产构建通过 `if (import.meta.env.DEV && ...)` 守卫，构建测试扫描产物确保不存在 fixture Token 和 fake backend 字符串。

- [ ] **Step 5: 运行完整自动化验证**

Run:

```bash
pnpm test
pnpm bridge:test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: 全部 exit 0；没有真实 API 请求；并行、权限、问题、停止、崩溃、设置冲突和删除均被覆盖。

- [ ] **Step 6: 提交测试闭环**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests bridge/src/agent-adapter.ts src-tauri/tests/full_loop.rs
git commit -m "test: cover Claude Desk closed loop"
```

### Task 15: 编译 sidecar、收紧桌面权限并生成双平台安装包

**Files:**
- Create: `scripts/build-sidecar.mjs`
- Create: `scripts/verify-package-config.mjs`
- Create: `.github/workflows/build-installers.yml`
- Create: `README.md`
- Rewrite: `docs/testing/platform-smoke.md`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: 已通过测试的应用和 Bridge。
- Produces: `artifacts/ClaudeDesk_<version>_aarch64.dmg` 与 `artifacts/ClaudeDesk_<version>_x64-setup.exe`。

- [ ] **Step 1: 写失败的打包配置测试**

新增脚本 `scripts/verify-package-config.mjs`，断言：identifier 正确、macOS minimum 13.0、NSIS currentUser、externalBin 为 `binaries/claude-agent-bridge`、capability 不含 shell execute、CSP 不允许任意远程 script。

Run: `node scripts/verify-package-config.mjs`

Expected: FAIL，打包配置尚未完成。

- [ ] **Step 2: 实现 sidecar 编译命名**

`build-sidecar.mjs` 根据 `TAURI_ENV_TARGET_TRIPLE` 或 `rustc -vV` 只接受：

```text
aarch64-apple-darwin -> src-tauri/binaries/claude-agent-bridge-aarch64-apple-darwin
x86_64-pc-windows-msvc -> src-tauri/binaries/claude-agent-bridge-x86_64-pc-windows-msvc.exe
```

使用 `bun build bridge/src/main.ts --compile --minify --outfile <exact-path>`。构建后执行 `handshake` 自检；不得把 SDK 可选 Claude 平台包放入 Tauri bundle。

- [ ] **Step 3: 完成 Tauri bundle 配置**

`tauri.conf.json` 固定：窗口 960×640 最小、背景 `#0b0b0a`、`externalBin`、macOS DMG、Windows NSIS currentUser。描述中删除 Diff/terminal 等旧功能。Rust 必须初始化 dialog 和 shell 插件；Bridge 只允许从 Rust 通过 `app.shell().sidecar("claude-agent-bridge")` 启动。`capabilities/default.json` 不包含任何 shell `execute`/`spawn` 权限，因此 Vue 前端不能直接启动任意命令。

- [ ] **Step 4: 添加手动 CI 构建矩阵**

Workflow 只允许 `workflow_dispatch`，矩阵：`macos-14/aarch64-apple-darwin/dmg` 和 `windows-2025/x86_64-pc-windows-msvc/nsis`。每个 job 执行 install → test → typecheck → bridge build → Tauri build → 上传 workflow artifact；不得创建 GitHub Release。

- [ ] **Step 5: 更新 README 和真实平台清单**

README 明确：用户需安装原生 Claude CLI `>=2.1.223`、App 不提供登录、Token 明文位于 settings.json、无遥测、未签名安装警告、macOS 右键打开和 Windows SmartScreen 步骤。`platform-smoke.md` 逐项覆盖 16 条验收标准，删除 Git Diff、SQLite task 和同目录冲突等旧条目。

- [ ] **Step 6: 运行最终自动化验证**

Run:

```bash
node scripts/verify-package-config.mjs
pnpm verify
pnpm test:e2e
```

Expected: 全部 exit 0，测试输出无 secret，生产 bundle 配置不包含 fake backend。

- [ ] **Step 7: 在 macOS Apple Silicon 生成并验证 DMG**

Run:

```bash
TAURI_ENV_TARGET_TRIPLE=aarch64-apple-darwin pnpm bridge:build
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg
```

Expected: Tauri build exit 0，生成 `.app` 和 `.dmg`。把 DMG 复制到 `artifacts/ClaudeDesk_0.1.0_aarch64.dmg`，随后按 `docs/testing/platform-smoke.md` 完成真实 CLI 冒烟测试并记录日期、CLI 版本和结果。

- [ ] **Step 8: 在 Windows x64 生成并验证 NSIS**

Run（必须在原生 Windows x64 或 Windows runner）：

```powershell
$env:TAURI_ENV_TARGET_TRIPLE = "x86_64-pc-windows-msvc"
pnpm bridge:build
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

Expected: Tauri build exit 0，生成 NSIS setup。复制为 `artifacts/ClaudeDesk_0.1.0_x64-setup.exe`，按清单验证安装、CLI 检测、并行、权限、设置、删除、退出和卸载。

- [ ] **Step 9: 提交打包和文档**

```bash
git add scripts .github package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/lib.rs README.md docs/testing/platform-smoke.md
git commit -m "build: package Claude Desk installers"
```

## Final Review Gate

- [ ] 逐条对照中文规格第 13 节的 16 条验收标准，并在 `docs/testing/platform-smoke.md` 记录证据。
- [ ] 运行 `pnpm verify`，确认前端、Bridge、Rust 测试、类型检查和生产构建全部 exit 0。
- [ ] 运行 `pnpm test:e2e`，确认项目 → 会话 → 流式响应 → 权限 → 设置闭环通过。
- [ ] 搜索构建输出、日志和测试快照，确认不存在真实或 fixture Token。
- [ ] 检查 `git status --short`，确认仅有预期的未跟踪 `artifacts/`，没有遗漏源码。
- [ ] 在 Apple Silicon Mac 安装 DMG，并使用真实本机 Claude CLI 完成冒烟测试。
- [ ] 在原生 Windows x64 安装 NSIS，并使用真实本机 Claude CLI 完成冒烟测试。
- [ ] 确认未创建 Release、未上传用户数据、未启用遥测、未加入自动更新或未批准功能。

## 实施资料

- [Claude Agent SDK TypeScript 参考](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK 会话接口](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Agent SDK 权限与用户输入](https://code.claude.com/docs/en/agent-sdk/user-input)
- [Claude Code 模型配置](https://code.claude.com/docs/en/model-config)
- [Tauri 2 文档](https://v2.tauri.app/)
