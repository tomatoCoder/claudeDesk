# 右侧浏览器面板与批注模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将浏览器改为 Claude Desk 右侧可调宽度的原生面板，并提供元素/文本批注模式。

**Architecture:** Vue 负责浏览器面板外壳、地址栏和批注按钮；Tauri 使用启用 `unstable` 特性的 child WebView 在主窗口内承载远程网页。远程 WebView 通过最小权限 `browser_comment` 回传评论，主窗口继续使用 `ConversationView.insertDraft` 追加草稿。

**Tech Stack:** Vue 3、TypeScript、Tauri 2、Rust、Tauri child WebView。

**Spec:** `docs/superpowers/specs/2026-09-13-browser-panel-annotations-design.md`

## Global Constraints

- 面板默认 680px，最小 420px、最大 960px；宽度仅本地保存。
- 只允许 HTTP(S) 地址；长度限制为 URL 4096、选区/元素文本 20,000、评论 4,000 字符。
- 网页评论只追加当前会话草稿，不自动发送或持久化。
- `browser-panel` 远程 WebView 只被授予 `browser_comment` 命令。
- 用户要求不运行测试、不创建提交、不执行 Git 命令。

---

### Task 1: 主窗口浏览器面板外壳

**Files:**
- Create: `src/components/browser/BrowserPanel.vue`
- Create: `src/services/browserPanel.ts`
- Modify: `src/App.vue`
- Modify: `src/services/i18n.ts`

**Interfaces:**
- Produces `BrowserPanel` emits: `close`, `resize(width)`, `navigate(url)`, `refresh`, `annotation-change(enabled)`。
- Produces `BrowserPanelBounds { x: number; y: number; width: number; height: number }` and `browserPanelState` helpers.

- [ ] **Step 1: 创建本地面板组件**

```ts
defineProps<{ width: number; url: string; annotationEnabled: boolean; error: string }>()
defineEmits<{ close: []; resize: [width: number]; navigate: [url: string]; refresh: []; annotationChange: [enabled: boolean] }>()
```

组件复用 `FileBrowserDrawer` 的拖拽尺寸与标题栏视觉语言，标题栏包含地址输入、刷新、批注 toggle、关闭；远程页面区域是 child WebView 的保留容器，不渲染 iframe。

- [ ] **Step 2: 将顶部入口与面板状态接入 App**

在 `App.vue` 将“浏览器”按钮与文件按钮并列，新增 `browserOpen`、`browserWidth`、`browserUrl`、`browserAnnotationEnabled`。`Cmd/Ctrl+T` 打开面板并聚焦地址栏。面板宽度写入 `claude-desk:browser-width`，浏览器评论继续调用 `formatBrowserCommentDraft` 和 `ConversationView.insertDraft`。

- [ ] **Step 3: 计算并同步 child bounds**

使用 `ResizeObserver` 观察 `BrowserPanel` 远程内容占位元素，在打开、关闭、拖动尺寸与主窗口变化时调用 `syncBrowserPanelBounds(bounds)`。bounds 为 main WebView 坐标系中真实网页区域，关闭时传 `visible: false`。

### Task 2: Rust child WebView 生命周期和权限

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands/browser.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/permissions/main-commands.toml`
- Delete: `src-tauri/capabilities/browser.json`
- Create: `src-tauri/capabilities/browser-panel.json`

**Interfaces:**
- Consumes `BrowserPanelBounds { x: f64, y: f64, width: f64, height: f64, visible: bool }`.
- Produces commands `open_browser_panel(url)`, `set_browser_panel_bounds(bounds)`, `refresh_browser_panel()`, `set_browser_annotation_mode(enabled)`, `close_browser_panel()`.

- [ ] **Step 1: 启用 Tauri child WebView API**

将 `tauri = { version = "2", features = ["unstable"] }`，以允许 `WebviewWindow::add_child`。保持依赖版本不变。

- [ ] **Step 2: 改造浏览器命令为单例 child WebView**

使用 `main_window.add_child(WebviewBuilder::new("browser-panel", WebviewUrl::External(url)), LogicalPosition, LogicalSize)` 创建；后续打开时 `navigate`、`set_position`、`set_size`、`show`。关闭时 `hide`，不销毁页面。删除独立 `WebviewWindowBuilder` 路径。

- [ ] **Step 3: 收紧 capability 并保留主窗口命令**

将 remote capability 目标改为 `webviews: ["browser-panel"]`、`local: false`、HTTP/HTTPS 规则、唯一 `browser-comment` permission。主窗口 capability 保留 `main-commands`，并在该 permission 清单中加入新的浏览器面板命令。

### Task 3: 元素与文本批注模式

**Files:**
- Modify: `src-tauri/src/commands/browser.rs`
- Modify: `src/services/browserUrl.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes `set_browser_annotation_mode(enabled: bool)` and `browser_comment(payload)`.
- Produces browser script message `{ url: string; selection: string; comment: string }`.

- [ ] **Step 1: 替换选区脚本为模式化批注脚本**

脚本导出 `window.__CLAUDE_DESK_SET_ANNOTATION_MODE__(enabled)`。关闭时移除全部临时节点；开启时 hover 绘制元素轮廓，click 优先使用 `window.getSelection()`，否则读取点击元素的规范化 `innerText`，并显示定位评论框和圆形标记。

- [ ] **Step 2: 控制脚本状态与导航清理**

`set_browser_annotation_mode` 对 child WebView `eval` 调用模式函数。refresh、navigate、close 与 bounds 隐藏都先关闭模式；地址导航后保持 UI toggle 关闭，避免网页加载后意外拦截点击。

- [ ] **Step 3: 保证回填与输入隔离**

评论提交仍只调用 `browser_comment`，后端校验再 emit 至 `main`。评论框的 Delete/Backspace/Enter 停止冒泡，Escape 仅取消输入框或批注模式；不影响 FileBrowserDrawer。

### Task 4: 静态交付检查

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-browser-panel-annotations.md`

**Interfaces:**
- Consumes任务 1–3 的命令与事件名称。

- [ ] **Step 1: 对照规格检查实现边界**

确认入口在会话右上、右侧面板不是 iframe、批注模式默认关闭、URL/评论限制后端仍有效、远程 capability 只允许评论命令。

- [ ] **Step 2: 记录用户要求的验证限制**

不运行测试、构建、开发服务器、Git 状态、暂存或提交命令；交付时明确说明未运行的验证。
