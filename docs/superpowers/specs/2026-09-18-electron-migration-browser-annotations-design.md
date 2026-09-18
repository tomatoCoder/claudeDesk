# Claude Desk Electron 全量迁移与浏览器标注重构设计

## 目标

将 Claude Desk 从 Tauri/Rust 全量迁移到 Electron/Node.js/TypeScript，最终产物不再包含 Rust。迁移后必须完整保留现有功能，无损兼容既有项目、任务、消息、事件、设置与运行记录，同时支持 macOS 和 Windows。

内置浏览器首版实现 Codex 风格的页面预览、元素/文字标注、评论驱动修改与刷新复核闭环。浏览器自动操作、截图分析和 CDP 调试不进入首版，作为明确的后续待办保留。

## 已确认范围

- 彻底移除 Tauri、Rust、Cargo 和相关构建链。
- 使用 Electron main process 重写现有 Rust 后端能力。
- 无损继承现有数据库、配置目录与用户数据，无需手动导入。
- 完整迁移项目、任务、消息流、运行队列、权限确认、文件浏览编辑、Git Diff、设置、诊断和终端入口。
- 首版同时支持 macOS 和 Windows，Linux 不在首版范围内。
- 浏览器首版只实现页面预览、元素/文字标注、评论驱动修改与复核。
- 采用兼容层驱动的纵向迁移，不采用一次性整体替换或长期双运行时。

## 迁移策略

迁移采用“固定外部契约、纵向替换实现”的方式：保留 Vue renderer 和现有前端 DTO、命令名与事件名，先建立 Electron 壳层与 typed preload，再按完整业务链逐条将 Rust 实现替换为 Node.js/TypeScript 实现。

迁移期间 `src-tauri/` 只作为行为与数据格式参考，不再承载新功能。每一阶段必须在 Electron 中形成可运行闭环。所有功能和双平台交付完成后，一次性删除 Tauri/Rust 目录、依赖和构建脚本，不长期维护两套运行时。

## 目标架构

```text
Vue Renderer
    ↓ typed preload API
Electron Main Process
    ├── SQLite 数据与迁移
    ├── Claude CLI / Bridge 管理
    ├── 任务队列与进程生命周期
    ├── 权限、文件、Git、设置与诊断
    └── WebContentsView 浏览器与标注
```

### 目录结构

```text
claudeDesk/
├── src/                         # Vue renderer，现有界面和状态管理
│   └── platform/desktop.ts      # 保留平台抽象，改接 Electron preload
├── electron/
│   ├── main/
│   │   ├── index.ts             # 应用启动与生命周期
│   │   ├── window.ts            # 主窗口创建
│   │   ├── ipc.ts               # IPC 白名单注册
│   │   ├── app-paths.ts         # 兼容原数据目录
│   │   ├── database/            # SQLite、repository、migration、备份
│   │   ├── claude/              # CLI 定位、版本、启动、解析
│   │   ├── tasks/               # coordinator、队列、取消与恢复
│   │   ├── permissions/         # 权限请求与授权记录
│   │   ├── projects/            # 项目和会话目录
│   │   ├── files/               # 文件列表、读取与写入
│   │   ├── git/                 # 状态、diff 与终端
│   │   ├── settings/            # 应用与 Claude 设置
│   │   ├── diagnostics/         # 日志和 CLI 诊断
│   │   └── browser/             # WebContentsView 与标注控制
│   ├── preload/
│   │   ├── main.ts              # 主界面最小权限 API
│   │   └── browser.ts           # 远程网页标注专用窄接口
│   └── shared/
│       ├── contracts.ts         # IPC 参数与返回值
│       ├── events.ts
│       └── errors.ts
├── bridge/                      # 复用现有 Claude Bridge
├── scripts/                     # Electron 打包和兼容性检查
└── src-tauri/                   # 迁移完成后删除
```

### 进程边界

- Vue renderer 只负责显示和交互，不能直接访问 Node、文件系统或子进程。
- 主 preload 只暴露 `DesktopPlatform` 所需的白名单接口，不暴露原始 `ipcRenderer`。
- Electron main 是数据库、文件、Git、子进程、窗口和浏览器管理的唯一特权进程。
- Browser WebContentsView 使用独立 session、沙箱和专用 preload，只能上报标注结果。
- Claude CLI 由 Electron main 使用 `child_process.spawn` 管理。
- SQLite 只允许 Electron main 单写，renderer 和远程网页不能直接连接。

## IPC 与错误契约

Vue 继续通过 `desktop.invoke`、`desktop.listen` 和 `desktop.openFiles` 使用桌面能力。Electron preload 将调用映射到 main process 的显式白名单。现有命令名和事件名优先保持不变，以限制 Vue 层改动范围。

IPC 参数、返回值和事件定义集中在 `electron/shared/`，renderer、preload 与 main 共用类型。main process 必须同时验证命令名、参数结构、调用来源和业务状态。

错误统一转换为：

```ts
interface AppError {
  code: string
  message: string
  recoverable: boolean
  details?: unknown
}
```

Node、SQLite、文件系统、Git、进程退出和 IPC 错误均映射为该结构。面向远程网页的错误不得包含堆栈、任意系统路径或内部 IPC 信息。

## 数据兼容与升级安全

### 数据目录

`electron/main/app-paths.ts` 负责识别 macOS 和 Windows 上既有 Claude Desk 数据目录。数据库继续使用 `claude-desk.db`，日志、配置和临时附件目录保持兼容。Electron 不得因默认 `userData` 路径不同而静默创建一套空数据。

### SQLite 兼容

- 保持现有表名、字段语义和 migration version。
- 先实现 schema 检查与只读访问，再开放 repository 写入。
- 旧 migration 不得重复执行。
- 时间、布尔值、JSON、空值和排序行为必须与旧实现一致。
- 新 Electron migration 只能在完整备份后执行，并置于单个事务内。
- SQLite 驱动必须兼容目标 Electron/Node ABI；最终版本在实施计划中锁定。

### 首次启动流程

```text
发现旧数据库
  → 检查 schema 和 migration version
  → 确认无活动写连接
  → 创建带时间戳的备份
  → 在事务内执行必要迁移
  → 执行完整性检查
  → 启动应用
```

迁移失败时回滚事务、保留原数据库并停止进入可写主界面。应用展示可理解的错误、日志路径、“重试”和“退出”，不得自动清空或重建数据库。

### 异常退出恢复

Electron 保持 `recover_interrupted_tasks` 的现有语义：上次异常退出时仍在运行的任务恢复为明确的中断状态，不自动重放可能产生副作用的请求，并保留已有消息、事件和错误信息。

应用正常退出时先停止接受新任务，再终止 Claude/Bridge 子进程并持久化最终状态。macOS 与 Windows 都必须终止完整子进程树。

### 配置兼容

Electron 继续识别现有应用设置和 Claude 设置，只管理当前应用已经负责的字段，不覆盖用户自定义字段。JSON 配置解析失败时保留原文件并返回诊断信息。Windows 路径、编码与换行差异必须显式处理。

## 后端能力迁移

### Claude CLI 与 Bridge

迁移后的运行链路为：

1. 定位 Claude CLI。
2. 获取版本并判断可用性。
3. 使用 `child_process.spawn` 启动现有 TypeScript Bridge。
4. 按行解析结构化输出。
5. 转换成现有 `TaskEvent`。
6. 持久化至 SQLite。
7. 推送给 Vue renderer。
8. 支持取消、异常退出和应用关闭清理。

优先复用现有 `bridge/` 协议和实现，不新增第二套 Claude 协议解析器。

### TaskCoordinator 与队列

- 同一任务同时只允许一个 active turn。
- 运行中提交的新消息按现有规则 steering 或进入队列。
- 队列支持更新、删除、调整和立即发送。
- 应用退出时检测 active task 并保留退出确认行为。
- 子进程异常退出后，任务进入明确的失败或中断状态。
- 不自动重放有副作用的请求。
- 使用内存 `Map<taskId, ActiveRun>` 配合 SQLite 持久化，不引入外部队列框架。

### 权限处理

```text
Claude Bridge
  → Electron PermissionCoordinator
  → task permission event
  → Vue PermissionCard / QuestionCard
  → 用户决策
  → Electron main 校验
  → Bridge 响应通道
```

main process 必须校验任务是否仍在运行、requestId 是否存在且未处理、decision 是否属于允许值，以及 updatedInput 与 permissionUpdate 的结构。仅用于 Tauri/Rust 通信的 permission helper 删除；如果 Claude CLI 协议仍需要独立 helper，则以最小 Node helper 替代。

### 文件、Git 与系统能力

- 文件浏览、搜索、预览和保存使用 Node `fs/promises`。
- 所有项目文件路径在 main process 内校验，禁止逃逸项目根目录。
- Git 继续调用系统 `git`，不引入 Git 重实现库。
- 终端入口按 macOS 和 Windows 分别适配系统能力。
- 文件选择使用 Electron `dialog`。
- 剪贴板和拖拽路径通过受控 preload 获取。
- 设置和诊断全部在 main process 内执行。

## 浏览器架构

### 承载方式

内置浏览器使用 Electron `WebContentsView`，不使用 iframe、`<webview>` 或已弃用的 `BrowserView`。

```text
主 BrowserWindow
├── Vue 应用 WebContents
└── Browser WebContentsView
    └── 远程网页
```

Vue `BrowserPanel` 只管理标题栏、地址栏、导航按钮和网页区域占位。Electron main 根据 Vue 上报的占位边界定位 WebContentsView。

首版支持 HTTP/HTTPS、localhost 默认 HTTP、前进、后退、刷新、跳转、加载状态、标题和 URL 同步、面板显隐与宽度调整。浏览器使用独立持久化 partition 保留登录态。关闭面板只隐藏网页视图，重新打开恢复现场。

首版不包含多标签、书签、独立历史管理和下载中心。

### 标注交互

1. 用户开启评论模式。
2. 鼠标悬浮元素时显示蓝色轮廓。
3. 点击元素或选中文字后冻结目标，并在页面显示编号 marker。
4. 应用侧显示相同编号的评论编辑器。
5. 提交后保留 marker 与评论，用户可以继续添加多条。
6. 评论先进入当前任务的浏览器反馈集合。
7. 用户确认后，反馈集合转换成一条可编辑会话消息，不自动提交。
8. Agent 修改代码后，用户刷新页面进行复核。
9. 无法重新定位的目标显示为失效，不允许模糊匹配到明显不同的元素。

评论输入位于应用 UI；远程页面内只注入轮廓、marker 和必要的选取逻辑，以减少目标网页 CSS、焦点、快捷键和弹层对评论编辑的影响。

### 标注数据

```ts
interface BrowserAnnotation {
  id: string
  taskId: string
  number: number
  url: string
  pageTitle: string
  comment: string
  selectedText?: string
  element: {
    tagName: string
    cssPath?: string
    xpath?: string
    ariaLabel?: string
    text?: string
    rect: { x: number; y: number; width: number; height: number }
  }
  viewport: {
    width: number
    height: number
    scrollX: number
    scrollY: number
  }
  createdAt: string
}
```

首版不默认保存截图。标注在当前应用进程内按 `taskId` 隔离；关闭并重新启动应用后不恢复未发送的浏览器标注。已经发送到会话中的反馈作为普通消息持久化。

### 会话消息格式

浏览器反馈在发送前生成清晰、可编辑的消息：

```text
请处理以下网页反馈。

页面：https://localhost:5173/settings

1. [按钮“保存”]
   评论：按钮和输入框之间的间距太小。

2. [选中文字“权限设置”]
   评论：标题层级不明显。
```

### 导航与生命周期

- 导航后保留当前任务中的标注数据，只显示属于当前 URL 的 marker。
- URL 相同且目标可可靠重新定位时恢复 marker。
- 刷新后重新注入标注运行时。
- 关闭评论模式清除悬浮和待提交目标，不删除已保存评论。
- 关闭浏览器面板不丢失当前任务内的标注。
- 切换任务时反馈集合按 `taskId` 隔离。

### 安全边界

远程网页始终视为不可信：

- `nodeIntegration: false`。
- `contextIsolation: true`。
- `sandbox: true`。
- 不暴露主应用通用 IPC。
- 标注 preload 只接受启停与 marker 恢复，只上报选择结果。
- main process 校验 IPC sender 是否属于当前 Browser WebContentsView。
- 拦截未授权新窗口、自定义协议和高风险权限。
- localhost 与公网网页执行相同的最小权限策略。

## 双平台构建与发布

首版同时支持 macOS 与 Windows：

- macOS 提供 Apple Silicon 与 Intel/Universal 构建策略，并预留签名与公证配置。
- Windows 提供 x64 安装包，并预留代码签名配置；无证书时允许生成内部验证包。
- 两个平台分别适配 Claude CLI 定位、环境变量、路径、shell 参数和子进程树终止。
- 打包工具优先选用 Electron Builder；只有与项目构建环境确认冲突时才改用 Electron Forge，不并存两套打包系统。

## 纵向实施顺序

1. Electron 应用启动、主窗口、preload 与 IPC 白名单。
2. 数据目录、SQLite、备份、项目与任务快照。
3. 会话和历史消息。
4. Claude CLI 单轮执行、流式事件、取消和退出。
5. steering、运行队列和异常恢复。
6. 权限确认与问题交互。
7. 文件、附件、剪贴板和拖拽。
8. Git、Diff、终端、设置和诊断。
9. WebContentsView 浏览器。
10. Codex 风格标注与评论闭环。
11. macOS、Windows 打包与升级验证。
12. 切换默认脚本并删除全部 Tauri/Rust 内容。

## 删除条件

满足以下条件后才允许删除 `src-tauri/`：

- Electron 能够打开旧数据库并完成完整性检查。
- 所有现有功能完成等价迁移。
- 浏览器标注闭环可用。
- macOS 和 Windows 均能安装、启动、执行核心流程并退出。
- 历史数据升级失败时能够安全回滚。
- 默认开发、构建和打包命令均已切换至 Electron。

随后删除 `src-tauri/`、Cargo 文件、Tauri permissions/capabilities、Tauri 专用图标副本、`@tauri-apps/*` 依赖和旧打包脚本。

## 验收标准

- 旧项目、任务、消息、事件和设置无损展示。
- 项目和任务的新增、修改、删除行为与旧版一致。
- Claude CLI 诊断、消息发送、流式输出、取消和异常处理正常。
- steering、消息队列及队列编辑正常。
- 权限确认和问题卡片正常。
- 文件浏览、搜索、预览、编辑、附件和剪贴板正常。
- Git 状态、Diff、设置、诊断和终端入口正常。
- 有运行中任务时的退出确认及异常退出恢复正常。
- 浏览器导航、登录态、刷新、前进后退和面板布局正常。
- 同一页面可添加多条元素或文字标注，并生成可编辑反馈消息。
- 标注按任务隔离，刷新后能够可靠恢复或明确显示失效。
- macOS 和 Windows 安装包升级旧版本后继续使用同一份用户数据。

## 验证约束

遵循项目现有协作规则，本次计划默认不新增、修改或运行自动化测试。实施阶段可以执行类型检查、生产构建检查，并使用数据库备份副本及人工 smoke checklist 验证。只有用户后续明确授权时，才增加或运行测试。

## 后续待办

以下能力明确不进入首版：

- Agent 自动点击、输入和页面操作。
- 页面截图、区域截图与视觉分析。
- DOM snapshot 与可访问性树快照。
- CDP 网络、Console、Runtime 和性能检查。
- 自动复现、修改、刷新与结果验证。
- 多标签页、下载管理、书签和独立浏览历史。
- 跨页面或跨任务的持久化标注工作流。

后续扩展应复用 BrowserManager、独立 session 和标注结构，不得扩大远程网页可直接调用的主应用权限。

## 非目标

- 首版不支持 Linux。
- 不重做现有 Vue UI 和产品信息架构。
- 不在迁移过程中引入通用插件系统或外部任务队列。
- 不同时维护 Tauri 与 Electron 两套正式版本。
- 不允许远程网页直接访问文件、Git、Shell、任务或通用 Electron IPC。
