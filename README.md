# Claude Desk

Claude Desk 是一个面向本地使用的 Claude Code CLI 桌面客户端，采用 Tauri 2、Vue 3、TypeScript 和 Rust 构建。它不会复制或接管 Claude 登录信息，而是直接使用当前用户已经安装并登录的 `claude` 命令。

## 当前功能

- 近黑色界面、暖白文字、Claude 橙色强调，以及固定左侧项目/任务导航。
- 多任务并行运行；同一项目并行时显示文件冲突风险提示。
- Claude `stream-json` 实时会话、会话 ID 恢复、工具调用卡片和结果用量。
- 原生权限确认与 `AskUserQuestion` 交互；“本任务内允许”仅使用 Claude 明确提供的权限规则，重启后不会保留。
- SQLite 保存项目、任务、事件和设置；Claude 原始 transcript 仍由 `~/.claude` 管理。
- 只读 Git 状态与 Diff、每任务最多 5 MiB 的原始日志、Claude 路径与登录诊断。
- 中止任务时终止 Claude 子进程树。

## 使用前准备

1. macOS 13+ 或 Windows 10 1809+。
2. 安装 Claude Code CLI `2.1.112` 或更高版本。
3. 在系统终端运行 `claude` 完成登录，并用 `claude auth status` 确认状态。

Claude Desk 不提供第三方登录页面，也不会读取、复制或上传 Claude 凭据。

## 开发运行

需要 Node.js 22+、pnpm 11+、Rust 1.88+：

```bash
pnpm install
pnpm tauri:dev
```

## 生成安装包

macOS Apple Silicon（必须在 macOS 主机执行）：

```bash
pnpm bundle:mac
```

输出位于 `src-tauri/target/release/bundle/macos/Claude Desk.app` 和 `src-tauri/target/release/bundle/dmg/`。当前配置使用 ad-hoc 签名，仅供本机或受信任设备使用；首次打开可能需要在“系统设置 → 隐私与安全性”中确认。

Windows x64（必须在 Windows x64 主机执行）：

```powershell
pnpm install
pnpm bundle:windows
```

NSIS 安装程序输出位于 `src-tauri\target\release\bundle\nsis\`，采用仅当前用户安装。未使用正式代码签名证书，因此 Windows SmartScreen 可能显示警告。

也可以推送到自己的 GitHub 仓库并手动运行 `Build installers` workflow，同时获得 macOS 与 Windows 构建产物。该 workflow 只上传内部 artifact，不创建公开 Release。

## 数据位置

应用数据库与日志由 Tauri 写入系统应用数据目录：

- macOS：`~/Library/Application Support/com.claudedesk.desktop/`
- Windows：`%APPDATA%\com.claudedesk.desktop\`

移除项目只删除 Claude Desk 的本地索引，不会删除项目文件。删除任务会删除应用数据库中的任务事件；Claude CLI 自己保存的原始会话不在此应用的删除范围内。

## 私有使用范围

这个 MVP 设计为个人或内部安装使用。若需要向第三方公开分发，应另行完成 Anthropic 条款、品牌使用、OAuth/API 凭据处理、代码签名和自动更新安全审查。
