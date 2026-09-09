# Platform smoke checklist

自动化测试按用户安排后续补充。生成候选安装包后，应在真实系统上逐项确认：

## macOS Apple Silicon

- 安装并打开 `.dmg`，将应用拖入 Applications。
- 首次启动后正确识别终端中已登录的 `claude`。
- 添加包含空格和非 ASCII 字符的项目目录。
- 新建两个任务并并行发送消息；同目录任务出现冲突提示。
- Claude 文本增量、工具调用与最终结果持续显示。
- Read 等无需额外权限的调用正常；Bash/Write/Edit 显示原生权限卡片。
- 允许一次、任务内允许、拒绝、AskUserQuestion 均能恢复运行。
- 中止包含子进程的任务后，Activity Monitor 中不残留 Claude 进程树。
- 关闭并重开应用，运行中任务恢复为“已中断”，历史事件可见。
- Git 状态、未暂存与已暂存 Diff 正确；非 Git 目录显示友好提示。

## Windows x64

- NSIS 以当前用户安装，不要求管理员权限。
- 在 PowerShell/CMD 可用的 `claude.exe` 能被 GUI 识别。
- 含空格、中文与较长路径的项目可以添加和运行。
- 并行、权限、恢复、Diff、日志行为与 macOS 一致。
- 停止任务后通过 Task Manager 确认 Claude 进程树已结束。
- 卸载器移除应用，但不删除项目目录或 Claude CLI 数据。

## 安全边界

- 前端没有 shell plugin 权限，任意文本都通过结构化 IPC 发送。
- prompt 只写入子进程 stdin，不拼接到命令行参数。
- 临时 MCP 配置不含 Claude 凭据，权限桥只绑定 `127.0.0.1` 并验证随机 token/run ID。
- 任务级权限规则仅存在当前应用进程内，重启后为空。
- 原始日志文件稳定限制在每任务最近 5 MiB。
