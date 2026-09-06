# Claude Desk 跨平台桌面应用设计

日期：2026-09-06  
状态：聊天设计已确认，等待书面设计最终审阅

## 1. 概述

Claude Desk 是一个仅供本地安装使用的 Claude Code 图形桌面客户端。它参考 Codex 的项目与任务工作流，用 Tauri 2、Vue 3 和 TypeScript 构建界面，由 Rust 后端启动用户已经安装并登录的 Claude Code CLI。

首版支持 macOS Apple Silicon 和 Windows x64。应用不进入应用商店、不创建公开发行版、不提供云同步，也不内置 Claude 登录流程或复制 Claude 凭证。

## 2. 产品目标

MVP 必须完成以下能力：

- 添加和管理本地项目目录。
- 在同一项目下创建、重命名、继续和删除多个任务。
- 同时运行多个任务，每个活动轮次使用独立 Claude CLI 子进程。
- 流式展示 Claude 回复、工具调用、命令、文件修改和结果。
- 在应用内显示权限确认卡片，并把用户决定返回 Claude CLI。
- 停止正在运行的任务并清理完整子进程树。
- 使用 Claude Session ID 在应用重启后继续指定会话。
- 展示当前项目工作目录的 Git 状态和 Diff。
- 保留结构化历史与有上限的原始诊断日志。
- 生成 macOS `.app`、`.dmg` 与 Windows NSIS `-setup.exe` 安装产物。

## 3. 非目标

以下能力不进入 MVP：

- Git worktree 或任何文件系统隔离。
- 将 Claude CLI 打包进安装程序。
- 通用交互式终端模拟器。
- 云端会话同步、团队共享或远程执行。
- 自动更新、应用商店发布、正式代码签名和公证。
- 插件市场、MCP 管理界面或账号管理界面。
- 自动把某个任务的文件修改与同目录的其他任务严格归因。

## 4. 平台和运行约束

### 4.1 支持范围

- macOS 13.0 或更高版本，Apple Silicon。
- Windows 10 1809 或更高版本、Windows 11，x64。
- 最少 4 GB 内存并可访问 Anthropic 服务。
- Windows 原生 Claude Code 可以使用 Git for Windows；未安装时由 Claude Code 自身回退到 PowerShell。

这些下限与 Claude Code 当前官方系统要求对齐。应用本身不支持 WSL 内部安装的 Claude CLI；Windows MVP 只调用 Windows 原生 Claude 可执行文件。

### 4.2 Claude CLI 前置条件

用户负责在系统上安装并登录 Claude Code CLI。Claude Desk 启动时按以下优先级查找 CLI：

1. 设置页保存的绝对路径。
2. 当前进程环境中的 `PATH`。
3. macOS 常见原生安装与 Homebrew 路径，以及登录 Shell 返回的路径。
4. Windows `where.exe` 结果和常见用户级安装路径。

候选文件必须通过绝对路径规范化、可执行性检查和 `claude --version` 探测后才能保存。所有 CLI 调用都通过结构化参数数组构造，不拼接包含用户输入的 Shell 字符串。

### 4.3 认证与使用边界

MVP 是用户自己构建和安装的私人本地工具。它只调用用户主动安装、主动登录的 Claude CLI，不展示第三方 OAuth 登录页，不读取、导出或保存认证令牌。

如果未来要把应用提供给其他用户或变成产品，必须先重新审查 Anthropic 对第三方应用认证的要求，并切换到获准的 API Key 或云服务商认证方式；本设计不授权公开分发。

## 5. 用户体验设计

### 5.1 视觉语言

界面采用用户提供参考图的视觉方向：

- 主背景为近黑色，Sidebar 和卡片使用不同层级的炭灰色。
- Claude 橙用于应用标记、主操作、运行状态和焦点态。
- 主要文字使用暖白色，次要文字使用中性灰色。
- 警告使用琥珀色，错误使用低饱和暗红色。
- 不逐像素复制第三方应用；只参考颜色、层次和左侧导航结构。

### 5.2 主窗口布局

窗口包含三个主要区域：

1. 左侧 Sidebar：应用标记、新建任务、按项目分组的任务列表、CLI 状态和设置入口。
2. 中央任务区：任务标题、项目路径、消息时间线、工具调用、权限请求和输入框。
3. 可切换辅助区：Git Diff 面板与底部原始日志抽屉。

Sidebar 可以调整宽度或折叠。任务状态至少包括空闲、启动中、运行中、等待审批、停止中、完成、中断和失败。

### 5.3 核心交互

- 用户选择本地目录后，应用创建或复用一个项目记录。
- 新建任务时先输入目标，再启动第一个 Claude CLI 轮次。
- 文本以 Markdown 渲染；代码块支持复制，但不执行其中内容。
- Read、Glob、Grep、Edit、Write、Bash 和其他工具统一渲染为可折叠卡片；未知工具使用通用 JSON 卡片。
- 用户可以随时停止当前轮次。停止不会删除任务历史，后续仍可通过 Session ID 继续。
- 同一工作目录存在两个及以上写入型活动任务时，Sidebar 和任务页显示冲突警告，但不阻止运行。
- Git Diff 代表整个工作目录当前状态，不声称属于某个单独任务。

## 6. 系统架构

```text
Vue 3 Renderer
  ├─ Pinia UI state
  ├─ Conversation / Sidebar / Diff components
  └─ typed Tauri IPC client
            │ commands + task-event stream
            ▼
Tauri Rust Core
  ├─ Command boundary and validation
  ├─ Task coordinator
  ├─ Claude process supervisor
  ├─ Stream JSON parser
  ├─ Permission broker
  ├─ SQLite repository
  ├─ Git reader
  └─ Diagnostics and bounded logs
            │ child process / stdio
            ▼
Installed Claude Code CLI
  ├─ Claude session transcripts
  ├─ Project settings and MCP configuration
  └─ User-owned authentication
```

Vue 层不直接访问 Shell、数据库或任意文件系统。所有有副作用的操作都经过类型化 Tauri Command，并在 Rust 层重新校验。

## 7. 前端模块

```text
src/
├─ components/
│  ├─ sidebar/
│  ├─ conversation/
│  ├─ permissions/
│  ├─ diff/
│  └─ diagnostics/
├─ views/
│  ├─ WorkspaceView.vue
│  └─ SettingsView.vue
├─ stores/
│  ├─ projects.ts
│  ├─ tasks.ts
│  └─ runtime.ts
├─ services/
│  ├─ ipc.ts
│  └─ taskEvents.ts
├─ domain/
│  └─ events.ts
└─ styles/
   ├─ tokens.css
   └─ app.css
```

- `projects` Store 管理项目和选中状态。
- `tasks` Store 管理持久任务元数据与事件分页。
- `runtime` Store 只管理当前进程、流式草稿和待审批请求等瞬时状态。
- IPC 客户端集中定义请求和响应类型，组件不直接调用散落的 Tauri API。
- 高频文本增量按动画帧或约 25 毫秒批量刷新，避免每个 token 触发完整渲染。

## 8. Rust 后端模块

```text
src-tauri/src/
├─ commands/       # Vue 可调用的受控入口
├─ claude/         # 定位、版本探测、参数和 JSONL 解析
├─ task/           # 状态机、单任务串行和跨任务并行
├─ process/        # 子进程组、取消和退出清理
├─ permission/     # MCP stdio helper 与本机桥接
├─ storage/        # SQLite、事务和迁移
├─ git/            # 只读 status/diff
├─ diagnostics/    # 日志、错误分类和环境摘要
└─ main.rs         # GUI 模式或 permission-helper 模式入口
```

模块边界遵循以下规则：

- `commands` 只做反序列化、授权检查、参数校验和调用领域服务。
- `task` 是唯一可以改变任务运行状态的模块。
- `process` 不理解 Claude 事件，只负责可取消进程生命周期。
- `claude` 不直接写 UI，只产生标准化领域事件。
- `storage` 不持有运行中进程，只提供事务化持久化接口。
- `git` 只执行只读命令，不提供 commit、checkout 或 reset。

## 9. Claude CLI 生命周期和数据流

### 9.1 单轮执行

每次用户发送消息时，Task Coordinator 执行以下流程：

1. 验证任务空闲、项目目录存在且 CLI 可用。
2. 创建运行 ID、取消令牌、临时 MCP 配置和短期 broker token。
3. 以项目目录作为 `cwd` 启动 Claude CLI。
4. 新任务发送普通 prompt；已存在会话的任务传入准确的 `--resume <session-id>`。
5. 使用非交互模式、`stream-json` 输入输出、详细事件和指定权限工具。
6. 分别读取 stdout 与 stderr；stdout 进入增量 JSONL 解析器，stderr 进入有界原始日志。
7. 将解析后的事件写入 SQLite，然后通过单一 `task-event` 通道发送给 Vue；每个事件带任务 ID、运行 ID 和单调递增序号。
8. 从初始化或结果事件捕获 Session ID，并在事务中更新任务记录。
9. 进程正常结束后把任务设为完成；异常结束映射为可恢复失败。

同一任务一次只允许一个活动轮次。不同任务可以并行，即使它们指向同一目录。

### 9.2 重启恢复

应用启动时，数据库中遗留的启动中、运行中、等待审批或停止中状态统一转换为“中断”。用户可以点击继续，应用用已保存 Session ID 启动新轮次。会话恢复依赖相同的绝对项目路径；目录重新定位后，应用要求用户确认新的项目记录，不静默改写旧会话的 `cwd`。

### 9.3 停止与进程回收

- macOS 为每次运行创建独立进程组，停止时先发送温和终止信号，短暂等待后再强制结束该进程组。
- Windows 将 Claude 及其后代加入 Job Object，停止或应用退出时关闭 Job，确保子进程一并结束。
- 应用关闭时，所有待审批请求先返回拒绝，再回收 CLI 和 permission helper。
- 停止结果必须幂等；重复点击不会影响其他任务。

## 10. 权限桥设计

Claude CLI 的非交互模式通过 `--permission-prompt-tool` 调用一个临时 MCP 工具。Claude Desk 不解析终端字符界面来猜测审批请求。

每个活动轮次按以下方式建立桥接：

1. 主 GUI 在本机回环接口开启临时监听端点并生成高熵 token。
2. 应用生成仅本轮有效的 MCP JSON 配置。配置中的命令指向 Claude Desk 自身可执行文件，并传入 `--permission-helper`、端点和 token。
3. Claude CLI 按 MCP stdio 协议启动 helper 模式进程。
4. helper 验证 token 后，把工具名、输入、建议权限范围和请求 ID 转发给主 GUI。
5. Vue 展示审批卡片，用户决定经 Rust 主进程返回 helper，再由 helper 返回 Claude CLI。
6. 轮次结束后删除临时配置、关闭监听端点并使 token 失效。

审批动作定义为：

- 允许一次：仅允许当前请求 ID。
- 本次任务始终允许：只缓存 Claude 提供的明确权限建议范围；如果没有安全的建议范围，则不显示该选项。
- 拒绝：返回拒绝结果，并可携带用户填写的简短原因。

活动授权规则只存在于当前应用进程的 Task Coordinator 内存中，并严格绑定任务 ID。它可以供同一任务在本次应用运行期间的后续轮次复用，但在应用退出、任务删除或用户手动清除授权时立即失效。数据库可以记录“发生过允许或拒绝”的事件用于界面历史，但不得把历史决定重新当作有效授权。这一规定消除了“本次任务始终允许”是否跨应用重启的歧义。

`AskUserQuestion` 使用专用问题卡片，不伪装成危险权限请求。审批超时、窗口关闭、helper 断开或请求格式未知时默认拒绝。

## 11. 持久化设计

SQLite 数据库位于 Tauri 的用户级应用数据目录，使用版本化迁移。核心表为：

- `projects(id, name, canonical_path, created_at, last_opened_at)`，其中规范化路径唯一。
- `tasks(id, project_id, title, claude_session_id, status, created_at, updated_at)`。
- `events(id, task_id, run_id, sequence, kind, payload_json, created_at)`，其中 `(task_id, run_id, sequence)` 唯一。
- `settings(key, value_json, updated_at)`。

消息、工具调用和审批结果都表示为带版本号的领域事件。写入顺序以 Rust 后端分配的序号为准，Vue 的临时流式状态在收到持久事件后合并，避免重启后重复消息。

原始 stdout 未识别行和 stderr 保存为每任务轮转日志，每个任务最多 5 MiB。日志完全留在本机，用户可在设置页清空。数据库和日志不主动复制项目源码，但工具输入或 Claude 回复本身可能包含代码，因此诊断导出必须由用户显式触发。

## 12. Git Diff

Git Reader 在项目目录中执行只读 Git 命令，并返回结构化文件状态和 patch：

- 已跟踪文件展示 staged 与 unstaged 状态和 patch。
- 未跟踪文件展示列表，并仅在用户选择时读取文本预览。
- 二进制文件只显示状态和大小，不尝试渲染 patch。
- 非 Git 目录隐藏 Diff 入口并显示“该项目未初始化 Git”。
- 大型 patch 分页或截断，并提供在外部编辑器打开文件的操作。

首版不记录每轮开始时的文件快照，因此 Diff 永远标记为“当前工作目录变更”，而不是“此任务产生的变更”。

## 13. 安全设计

- Tauri capability 采用最小权限；Vue 无通用 Shell 执行权限。
- 仅 Rust 后端可以启动经过验证的 Claude 路径和固定的只读 Git 子命令。
- 所有用户文本通过 stdin 或单独进程参数传递，绝不插入 Shell 命令字符串。
- Markdown 禁止原始脚本、事件属性和危险 URL，并在渲染前清洗 HTML。
- 外部链接必须由用户点击，并通过受控 opener 打开。
- 权限 broker 只监听回环接口，token 单轮有效，请求还必须匹配运行 ID。
- 临时 MCP 配置使用用户私有权限创建，并在正常结束和崩溃恢复时清理。
- UI 不提供 `bypassPermissions`，也不提供跨任务永久允许。
- 任何来自项目文件、Claude 输出或工具结果的文字都视作不可信显示数据。

## 14. 异常处理

- CLI 不存在：阻止任务启动并显示路径探测结果与官方安装入口。
- CLI 未登录：保留 CLI 的原始错误，提示用户在外部终端完成登录后重新检测。
- CLI 版本或事件不兼容：已知事件继续显示，未知事件进入原始日志；不会导致整个窗口崩溃。
- CLI 异常退出：保存已接收事件和 Session ID，任务进入可重试失败状态。
- JSONL 行不完整：缓存到下一数据块；进程结束仍不完整时记录解析错误。
- 权限请求失联或超时：默认拒绝，不自动重试危险操作。
- 项目目录丢失：任务进入不可运行状态，允许重新添加目录但不静默更改旧任务上下文。
- SQLite 写入失败：暂停该任务的新输入并展示可导出的诊断；不继续产生无法恢复的 UI 历史。
- 多任务写入同一目录：显示持续警告，用户仍拥有最终决定权。

## 15. 测试策略

### 15.1 前端测试

使用 Vitest 和 Vue Test Utils 覆盖：

- 项目分组、任务状态和 Sidebar 折叠。
- 流式消息增量合并和 Markdown 安全渲染。
- 工具卡片、未知事件降级和原始日志。
- 允许一次、任务内允许、拒绝和超时状态。
- 应用重启后的 Store 重建与事件去重。

### 15.2 Rust 测试

使用 `cargo test` 覆盖：

- macOS 与 Windows CLI 候选解析和版本探测。
- Claude 参数构造，尤其是包含空格和特殊字符的项目路径与 prompt。
- 分块 JSONL、未知事件和损坏行解析。
- 任务状态机非法转换、取消幂等和跨任务隔离。
- broker token、运行 ID 和审批生命周期。
- SQLite 迁移、事务、序号唯一性和崩溃状态恢复。
- Git 状态、文本 patch、二进制和非 Git 项目。

### 15.3 集成测试

仓库提供一个 Rust 测试 helper，编译后充当假 Claude CLI。它可以输出固定 JSONL、延迟 token、发起模拟审批、写 stderr、返回 Session ID、挂起或异常退出。集成测试不访问 Anthropic，也不消耗额度。

必须覆盖以下链路：

- 新任务流式完成。
- 保存 Session ID 后继续任务。
- 审批允许、拒绝、超时和 helper 断开。
- 用户停止后无残留进程。
- 两个任务并行且事件不串线。
- 应用重启后把活动状态转换为中断并成功继续。

### 15.4 平台验收

- macOS 13+ Apple Silicon：安装、启动、CLI 探测、真实对话、审批、文件修改、Diff、停止、继续和卸载。
- Windows 10 1809+/11 x64：执行同一套验收，并验证 PowerShell 与 Git for Windows 两种环境。
- 每个平台至少验证一次包含空格和非 ASCII 字符的项目路径。

## 16. 构建与安装

前端包管理器采用 pnpm。Tauri 生成以下产物：

- macOS Apple Silicon：`.app` 和 `.dmg`，使用 ad-hoc 签名。
- Windows x64：按当前用户安装的 NSIS `-setup.exe`，默认不要求管理员权限。

仓库包含 GitHub Actions 双平台构建工作流，但不创建 GitHub Release。工作流只使用 artifact 上传构建结果；也保留目标平台本机构建命令。Windows 安装包优先在 Windows runner 上生成，不依赖从 macOS 交叉编译。

没有正式证书时：

- macOS 用户仍需在“隐私与安全性”中允许该应用；ad-hoc 签名不等于公证。
- Windows 可能显示 SmartScreen 未知发布者提示。

这些提示在私人本地安装范围内接受。正式外部分发必须新增签名、公证和供应链流程。

## 17. 验收标准

MVP 只有在以下条件全部满足时才算完成：

1. macOS Apple Silicon 与 Windows x64 都生成可安装产物。
2. 两个平台均能发现自定义路径或系统安装的已登录 Claude CLI。
3. 用户能添加项目、新建多个任务并看到流式回复与工具卡片。
4. 权限请求在原生卡片中完成，失败路径默认拒绝。
5. 用户能停止任务，应用退出后没有残留 Claude 或 helper 进程。
6. Session ID 被保存，应用重启后能继续准确的任务。
7. Git 项目能展示明确标注为工作目录级别的状态和 Diff。
8. 两个任务可并行运行，事件不串线，同目录写入时有冲突提示。
9. 未知事件、CLI 崩溃、目录丢失和数据库错误都有可理解且可恢复的界面状态。
10. 前端、Rust 和假 CLI 集成测试全部通过，两个目标平台完成真机验收。

## 18. 参考资料

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code session management](https://code.claude.com/docs/en/sessions)
- [Claude Code system requirements and setup](https://code.claude.com/docs/en/setup)
- [Tauri v2 distribution](https://v2.tauri.app/distribute/)
- [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri macOS application bundle](https://v2.tauri.app/distribute/macos-application-bundle/)
