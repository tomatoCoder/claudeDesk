# Claude Desk

Claude Desk 是一个供个人或团队内部安装使用的 Claude Code 桌面客户端。它采用 Tauri 2、Vue 3、TypeScript、Rust 和 Claude Agent SDK 构建，界面使用 Claude Code 风格的近黑、暖白与橙色主题。

这个 MVP 只完成一个最小闭环：发现本机 Claude CLI，按“项目 → 会话”浏览本地历史，创建或恢复会话，流式对话并处理工具授权，以及同步三项用户级模型配置。

## 已实现范围

- 从 Claude 本地会话中发现项目，并支持手动添加项目目录。
- 左侧“项目 → 会话”导航；会话可创建、恢复、重命名和移入废纸篓/回收站。
- 流式展示 Markdown、代码块、工具调用、重试、错误和运行状态。
- 工具权限允许/拒绝及 `AskUserQuestion` 交互；断开或终止时默认拒绝。
- 不同会话可并行运行；同一会话同时只运行一个轮次。
- 设置页读取和修改 `~/.claude/settings.json` 中的 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_MODEL`。
- macOS Apple Silicon DMG 与 Windows x64 NSIS 安装包。

不包含内嵌终端、Git Diff、代码审查、云同步、CLI 安装/更新、App 内登录、自动更新和正式发布流程。

## 使用前准备

1. 使用 macOS 13+（Apple Silicon）或 Windows 10 1809+（x64）。
2. 自行安装原生 Claude Code CLI `2.1.223` 或更高版本，并确保终端中可执行 `claude --version`。
3. 通过 Claude CLI 完成正常认证，或在设置页配置自定义网关所需的 Token、Base URL 和模型。

Claude Desk 不内置 Claude CLI，也不提供登录页面。`ANTHROPIC_AUTH_TOKEN` 会按 Claude Code 的配置方式以明文写入当前用户的 `settings.json`，请保护该文件及系统账户；界面默认掩码显示 Token，日志和诊断信息不得包含 Token。

## 开发运行

需要 Node.js 24+、pnpm 11+、Rust 1.88+：

```bash
pnpm install
pnpm tauri:dev
```

开发模式会先把 TypeScript Agent Bridge 编译到 `bridge/dist/`。应用使用用户本机的 Claude CLI；最终用户无需安装 Node.js 或 Bun。

## 运行测试

```bash
pnpm test
pnpm bridge:test
pnpm bridge:typecheck
pnpm bridge:sidecar:test
cargo test --manifest-path src-tauri/Cargo.toml
```

## 生成安装包

macOS Apple Silicon 必须在 Apple Silicon Mac 上构建：

```bash
pnpm bundle:mac
```

输出位于 `src-tauri/target/release/bundle/macos/Claude Desk.app` 和 `src-tauri/target/release/bundle/dmg/`。

Windows x64 必须在 Windows x64 主机上构建：

```powershell
pnpm install
pnpm bundle:windows
```

NSIS 安装程序位于 `src-tauri\\target\\release\\bundle\\nsis\\`，采用当前用户安装，不要求管理员权限。

构建命令会先使用 Bun 将 Agent Bridge 编译为目标平台 sidecar，并执行协议握手自检，然后再交给 Tauri 打包。仓库中的 `Build installers` workflow 也可手动运行，它只生成内部 artifact，不创建公开 Release。

## 未签名安装提示

安装包仅用于本机或受信任设备，未进行 Apple 公证或商业代码签名：

- macOS：若系统阻止首次打开，请在 Finder 中右键应用选择“打开”，或前往“系统设置 → 隐私与安全性”确认。
- Windows：若 SmartScreen 提示未知发布者，请确认安装包来源后选择“更多信息 → 仍要运行”。

## 本地数据与删除行为

- Claude 设置：macOS `~/.claude/settings.json`；Windows `%USERPROFILE%\\.claude\\settings.json`。
- Claude 会话：继续由 Claude CLI 管理在用户目录下的原生会话存储中。
- Claude Desk 的界面索引和运行事件：系统应用数据目录中的 `com.claudedesk.desktop` 目录。

移除项目只移除 Claude Desk 的本地项目索引，不会删除项目源码。删除原生 Claude 会话时，只匹配该会话完整 UUID 对应的 transcript 和附属目录，并移入操作系统废纸篓或回收站；不会清理整个项目。

Claude Desk 不包含遥测、云端同步或自动更新。若要向第三方公开分发，仍需完成 Anthropic 条款与品牌审查、代码签名、公证和更新链路安全审查。
