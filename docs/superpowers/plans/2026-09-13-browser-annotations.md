# 浏览器选中文本注释 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claude Desk 中提供原生浏览器入口，并将网页选区和评论追加到当前会话草稿。

**Architecture:** 主窗口负责入口、地址输入和草稿写入；Rust 创建单例远程 WebView 并通过窄 `browser_comment` 命令把不可信文本事件转给 `main` 窗口。远程 WebView 不拥有文件、Shell、项目或任务权限。

**Tech Stack:** Vue 3、TypeScript、Vitest、Tauri 2、Rust。

**Spec:** `docs/superpowers/specs/2026-09-13-browser-annotations-design.md`

## Global Constraints

- 只接受 `http://` 与 `https://`；缺少协议时补 `https://`。
- URL、选区、评论最大长度分别为 4096、20,000、4,000 字符。
- 评论仅通过 `ConversationView.insertDraft` 追加，绝不自动发送或持久化。
- 浏览器窗口为标签 `browser` 的单例；远程窗口只获 `browser_comment` 权限。
- 用户明确要求本轮不运行测试、不创建提交，也不执行任何 Git 操作。

---

### Task 1: 前端浏览器契约与侧边栏入口

**Files:**
- Create: `src/services/browserUrl.ts`
- Create: `src/services/browserShortcut.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/services/i18n.ts`
- Modify: `src/components/sidebar/AppSidebar.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Produces `normalizeBrowserUrl(value: string): string`、`formatBrowserCommentDraft(payload: BrowserCommentPayload): string`。
- Produces `isBrowserShortcut(event: KeyboardEvent, blocked: boolean): boolean`。
- Produces `ipc.openBrowser(url: string): Promise<void>` 和浏览器事件 payload `{ url: string; selection: string; comment: string }`。

- [ ] **Step 1: 添加纯前端 URL 与草稿格式服务**

```ts
export interface BrowserCommentPayload { url: string; selection: string; comment: string }
export function normalizeBrowserUrl(value: string): string
export function formatBrowserCommentDraft(payload: BrowserCommentPayload): string
```

`normalizeBrowserUrl` 先 trim，缺协议补 `https://`，通过 `URL` 校验且只允许 `http:` 与 `https:`，并在超过 4096 字符时抛中文错误。`formatBrowserCommentDraft` 输出评论、网址和 fenced code block 中的选区。

- [ ] **Step 2: 增加快捷键、IPC 和文案**

`isBrowserShortcut` 只接受 macOS 的 `metaKey + t` 或其他平台的 `ctrlKey + t`，同时拒绝额外修饰键与 `blocked` 状态。`ipc` 增加 `openBrowser`。i18n 增加“浏览器”“输入网址”“打开浏览器”“请先选择会话”等中英文文案。

- [ ] **Step 3: 在侧边栏和主窗口连接入口**

在 `AppSidebar` 使用 Globe 图标发出 `open-browser`；`App.vue` 显示地址输入对话框、拦截全局快捷键、调用 `ipc.openBrowser`，并订阅 `browser-comment`。事件到达且存在任务时调用 `conversationView.insertDraft(formatBrowserCommentDraft(payload))`；没有当前任务时显示错误。

### Task 2: 受限原生浏览器与评论回传

**Files:**
- Create: `src-tauri/src/commands/browser.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/capabilities/browser.json`

**Interfaces:**
- Consumes `open_browser(url: String, app: AppHandle)` 和 `browser_comment(payload: BrowserCommentPayload, app: AppHandle)`。
- Produces `browser-comment` 事件，payload 为 `{ url, selection, comment }`。

- [ ] **Step 1: 实现 Rust 校验模型和浏览器窗口管理**

定义 `BrowserCommentPayload { url: String, selection: String, comment: String }`。共享 `normalize_browser_url` 与 `validate_browser_comment`：拒绝空值、非 HTTP(S)、超长字段；`open_browser` 使用标签 `browser` 查找现有窗口，存在时导航并 show/focus，否则以 `WebviewWindowBuilder` 创建宽 1200、高 850 的新窗口。

- [ ] **Step 2: 注入网页选区评论脚本**

在浏览器窗口载入与导航时执行初始化脚本。脚本监测 `mouseup`，读取非空 `window.getSelection()`，以 Shadow DOM 建立固定定位输入条；取消/Escape/换选区关闭，提交及 `Meta/Ctrl+Enter` 调用 `window.__TAURI__.core.invoke('browser_comment', { payload })`。脚本只传递 `location.href`、选区和输入评论。

- [ ] **Step 3: 注册命令与最小 capability**

将 `browser` 模块和两个命令加入 `commands`、`generate_handler!`。新 capability 仅匹配窗口标签 `browser` 和远程 `http/https` 来源，并且 permission 列表只允许 `browser_comment`；不将浏览器窗口加入 `default.json`。

### Task 3: 手动验证准备与回归保护

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/files/FileBrowserDrawer.vue`（仅在实现发现快捷键冒泡冲突时）

**Interfaces:**
- Consumes浏览器事件与现有 `ConversationView.insertDraft`。

- [ ] **Step 1: 对照主流程做静态检查**

确认地址输入不在 modal、文本输入或设置视图打开时被 `Cmd/Ctrl+T` 覆盖；确认 `browser-comment` 事件不发送消息，且没有任务时不将其写给其他会话。

- [ ] **Step 2: 保持现有文件输入行为隔离**

确认浏览器评论输入的 Delete/Backspace 不会通过主窗口键盘事件关闭文件抽屉；仅在发现共享事件路径时对文件抽屉的 Escape 过滤加固。

- [ ] **Step 3: 不执行验证命令或 Git 命令**

遵照用户本轮明确指示，不运行测试、构建、Git 状态、暂存或提交命令；仅报告已实施的变更与尚未验证的风险。
