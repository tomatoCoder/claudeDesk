# Claude Desk

Claude Desk 是基于 Electron、Vue 3、TypeScript、SQLite 和 Claude Agent SDK 的 Claude Code 桌面客户端。

## 已实现范围

- 发现本机 Claude CLI，并按“项目 → 会话”浏览、创建、恢复和管理会话。
- 流式展示消息、Markdown、代码块、工具调用、权限请求、问题和运行状态。
- 同一会话串行执行，不同会话可并行；支持消息队列、调整与停止。
- 文件浏览、搜索、预览、编辑、Git Diff、项目打开方式和外部终端。
- Codex 风格内置浏览器：页面预览、元素/文字标注、多评论汇总和刷新复核。
- 安全读写 `~/.claude/settings.json`，保留应用不管理的自定义字段。

浏览器自动操作、截图分析、CDP 调试和持久化跨页面标注在 [后续待办](docs/backlog/browser-automation.md) 中。

## 使用前准备

1. 使用 macOS 13+ 或 Windows 10 1809+（x64）。
2. 安装原生 Claude Code CLI，并确保 `claude --version` 可执行。
3. 通过 Claude CLI 完成认证，或在设置页配置自定义网关。

Claude Desk 不内置 Claude CLI，也不提供登录页面。Token 由 Claude Code 配置文件管理，界面默认掩码显示，应用日志会执行密钥脱敏。

## 开发

需要 Node.js 24+ 与 pnpm 11+，不需要 Rust：

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会编译 TypeScript Bridge 与 Electron main/preload，启动 Vite，然后打开 Electron。

只做静态和生产构建检查：

```bash
pnpm typecheck
pnpm electron:compile
pnpm build
```

## 打包

macOS：

```bash
pnpm bundle:mac:arm64
pnpm bundle:mac:intel
```

Windows x64：

```powershell
pnpm bundle:windows
```

`pnpm bundle:mac` 等同于 `pnpm bundle:mac:arm64`。产物统一写入 `release/`。GitHub Actions 可手动运行 `Build installers`，并分别上传 macOS arm64、macOS Intel 和 Windows x64 三份构建产物。`CSC_LINK` 与 `CSC_KEY_PASSWORD` 可用于代码签名；macOS 同时提供 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 时启用公证。凭据不得写入仓库。

## 本地数据

- Claude 设置：macOS `~/.claude/settings.json`；Windows `%USERPROFILE%\\.claude\\settings.json`。
- Claude 会话：继续由 Claude CLI 管理。
- Claude Desk 数据库和日志：系统应用数据目录下的 `com.claudedesk.desktop`。

Electron 延续历史应用 ID 与数据目录。启动迁移前会创建数据库备份；迁移失败不会自动清空数据。移除项目只删除应用索引，不删除项目源码。

## 常见问题

- Electron 下载失败：检查 npm registry、代理和 Electron mirror 配置后重新执行 `pnpm install`。
- Claude 未检测到：先在同一用户终端执行 `claude --version`，再在设置页重新检测。
- 页面无法预览：当前仅允许 HTTP/HTTPS；远程页面权限、弹窗和自定义协议默认拒绝。
- 打包后的 Bridge 不可用：确认 `bridge/dist` 与 `bridge/node_modules` 已进入应用 resources。

项目不包含遥测、云同步或自动更新。公开分发前仍需完成条款、品牌、签名、公证和更新链路安全审查。
