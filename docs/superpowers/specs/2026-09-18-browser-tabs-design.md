# 浏览器多标签设计

## 目标

把现有单个 `WebContentsView` 浏览器侧栏升级为会话级多标签浏览器。每次点击任务头部的“浏览器”按钮都创建一个空白标签并聚焦地址栏；每个标签可以独立切换和关闭。关闭最后一个标签时关闭整个浏览器侧栏。

## 用户交互

- 点击任务头部“浏览器”按钮总是新建标签，不再只负责显示已有浏览器。
- 新标签标题为“新标签页”，地址为空，创建后立即成为当前标签并聚焦地址栏。
- 标签栏位于浏览器标题栏和导航工具栏之间，展示标签标题与关闭按钮。
- 点击标签切换当前网页；前进、后退、刷新、地址栏、批注和全屏只作用于当前标签。
- 关闭当前标签后优先激活右侧相邻标签；没有右侧时激活左侧标签。
- 关闭后台标签不改变当前标签。
- 删除最后一个标签时关闭整个浏览器侧栏。
- 标签只保留到应用退出，不写入数据库或本地存储。
- 网页请求打开新窗口时继续沿用现有拒绝策略，本期不自动创建标签。

## 前端状态

`App.vue` 持有轻量标签元数据：

```ts
interface BrowserTab {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string
}
```

同时保存 `browserTabs` 和 `activeBrowserTabId`。`browserOpen` 可由标签数量和面板显示状态派生或继续显式维护，但必须满足“零标签即关闭”。现有单标签字段迁移到当前标签，页面状态事件通过 `tabId` 精确更新，避免后台页面事件覆盖当前地址栏。

`BrowserPanel.vue` 接收标签列表和当前标签 ID，渲染标签栏并发出 `tab-select`、`tab-close`。组件现有导航、批注、全屏与边界计算保持不变。

## Electron 主进程模型

`BrowserManager` 从单个 `view` 改为：

```ts
Map<string, BrowserTabView>

interface BrowserTabView {
  view: WebContentsView
  error?: string
}
```

并记录当前 `activeTabId`、共享面板边界和可见状态。

- 创建标签时创建独立 `WebContentsView`，注册与现有实例相同的导航、安全、页面状态和批注监听。
- 激活标签时只显示当前 View，其他 View 保持挂载但设为不可见，以保存滚动位置、表单和导航历史。
- 面板尺寸变化时只更新当前 View；切换标签时将缓存边界立即应用到新当前 View。
- 关闭标签时从窗口移除对应 View 并关闭其 `webContents`，防止资源泄漏。
- 应用退出时遍历关闭所有 View。
- 批注模式仍是当前任务级状态，创建或激活标签时向对应 View 同步模式和标记。

## IPC 变更

所有会操作具体网页实例的命令增加 `tabId`：

- `create_browser_tab`
- `select_browser_tab`
- `close_browser_tab`
- `open_browser_panel`
- `browser_history`
- `refresh_browser_panel`

边界设置仍是面板级命令，不要求调用方逐标签发送；主进程将其应用于当前标签。关闭整个面板只隐藏当前 View，不删除标签；删除最后一个标签由前端关闭侧栏并由主进程销毁对应 View。

页面状态事件增加 `tabId`：

```ts
interface BrowserPageState {
  tabId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
}
```

批注提交由触发事件的 View 自带所属 `tabId`，主进程按该 View 的实际 URL 校验，不信任渲染进程提供的标签身份。

## 生命周期与错误处理

- 创建 View 或加载空白页失败时，不留下半创建标签；主进程返回错误，前端移除对应元数据并展示全局错误。
- 单个标签加载失败只更新该标签的错误，不影响其他标签。
- 关闭不存在的标签视为幂等操作，避免快速连点造成额外错误。
- 选择不存在的标签返回可展示错误，防止前后端状态静默分叉。
- 标签 ID 在前端生成并在主进程校验为非空、有限长度字符串；本地会话内唯一。

## 响应式与全屏

- 标签栏横向滚动，不压缩导航控件；活动标签始终滚动到可见区域。
- 普通侧栏沿用现有宽度约束；标签标题省略显示。
- 应用内全屏继续覆盖整个窗口，标签栏随浏览器面板一起显示。
- 全屏或侧栏尺寸变化后由现有 `ResizeObserver` 触发边界同步。

## 验证范围

遵照项目规则，本次不新增、修改或运行测试。实施后执行 TypeScript 类型检查、Electron 编译、生产构建和 `git diff --check`，并手动检查以下关键流程：连续创建三个标签、分别导航、切换后页面状态保留、关闭后台标签、关闭当前标签、关闭最后一个标签、全屏切换以及当前标签批注。

## 非目标

- 重启后恢复标签。
- 标签拖拽排序、固定、复制或静音。
- 网页弹窗自动创建标签。
- 后台标签冻结或内存回收策略。
- 跨任务或跨项目保存不同标签集合。
