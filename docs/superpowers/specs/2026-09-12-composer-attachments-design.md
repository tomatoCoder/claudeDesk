# Composer 附件按钮与附件 Chip 设计

**日期：** 2026-09-12

**状态：** 已在对话中确认

**参考样式：** Codex 消息输入框

## 1. 背景与目标

`ComposerBox` 是消息输入框。当前拖拽文件到输入框会把文件绝对路径直接追加到输入文本中（commit `0f1c1d5`），但没有附件按钮，附件也无法单独管理。

本次改动：

1. 在输入框 footer 左下角新增附件按钮（"+"，回形针图标）。
2. 通过按钮选择或拖拽放入的文件以**可删除的附件标签（Chip）**形式展示在输入框内。
3. 发送时附件路径逐行合并进 prompt 文本，`submit(text: string)` 契约保持不变。

## 2. 非目标

- 不改变 `submit(text)` 组件契约，不改 App / ConversationView / Rust bridge。
- 不支持文件内容上传——后端 Claude CLI 只接收文本 prompt，附件即绝对路径。
- 不做剪贴板粘贴附件。
- 不做附件预览、缩略图或文件类型分组。

## 3. UI 布局

- **Footer 左侧**：附件按钮（`Paperclip` 图标，lucide-vue-next），样式与现有 `send` / `stop` 按钮同族（圆形小按钮、悬停效果一致），带 `title` 提示。快捷键提示文字仍在其后（`margin-right: auto` 移到提示 span 上），右侧保持停止 / 发送按钮不变。
- **Chip 列表**：渲染在 `QueuedTurnList` 之下、`textarea` 之上。每个 Chip 显示路径 basename，`title` 显示完整路径，右侧 X 按钮删除。
- **拖拽高亮**：保留现有 `drag-active` 边框高亮与覆盖提示。

## 4. 状态与数据流

- ComposerBox 新增本地状态 `attachments: string[]`（绝对路径，去重）。
- 统一入口 `addAttachments(paths: string[])`：trim、去空、与现有列表去重；沿用现有 500ms 重复 drop 防抖（`lastDropKey` / `lastDropAt`）。
- 删除 Chip：从数组移除对应路径。

### 附件按钮

- 仅在桌面模式（`isDesktop()`）渲染：浏览器 dev 模式下 `<input type="file">` 无法获得真实绝对路径，隐藏按钮；拖拽已有降级逻辑，不受影响。
- 点击调用 `@tauri-apps/plugin-dialog` 的 `open({ multiple: true, title: t('addAttachment') })`（插件已在依赖中，`chooseProjectDirectory` 已有使用先例）。
- 返回的路径数组交给 `addAttachments`；用户取消（返回 `null`）时无操作。

### 拖拽

- `handleBrowserDrop` 仍按现有逻辑提取路径（DataTransfer + Tauri `readDragFilePaths` IPC 兜底），但结果交给 `addAttachments` 加入附件列表，**不再直接改写文本**。
- `dropFilesHere` 文案改为"松开以添加附件" / "Drop to add attachments"。

## 5. 发送逻辑

- 发送条件：`text.trim()` 非空 **或** `attachments` 非空。
- prompt 组装：`[text, ...attachments]` 过滤空值后以换行拼接（文本为空时 prompt 只含路径行）。
- 发送成功（`submit` 未返回 false）后清空 `text` 与 `attachments`；返回 false（裸命令被拦截）时两者都保留。
- 发送按钮 disabled 条件同步更新：`!text.trim() && !attachments.length`。

## 6. i18n

新增 / 修改键（中英双语）：

- `addAttachment`：添加附件 / Attach files
- `removeAttachment`：移除附件 / Remove attachment
- `dropFilesHere`：松开以添加附件 / Drop to add attachments

## 7. 错误处理

- 文件对话框抛错：静默忽略（与现有拖拽 IPC 兜底一致的保守策略），不阻塞输入。
- 队列轮次（adjust / update / sendNow / remove）只操作文本，不涉及附件。

## 8. 测试（ComposerBox.spec.ts 扩展）

mock `isDesktop` 与 `@tauri-apps/plugin-dialog`：

1. 点击附件按钮 → 对话框返回路径 → Chip 渲染 basename；取消 → 无变化。
2. 删除 Chip → 附件移除。
3. 拖拽 drop → 路径进入附件列表而非文本。
4. 仅附件无文本时发送按钮可用，提交的 prompt 为路径行。
5. 文本 + 附件混合时 prompt 按序拼接。
6. `submit` 返回 false 时附件保留；成功后清空。
7. `addAttachments` 去重与 500ms 防抖。
