# Claude Desk 斜杠命令补全（Task 2~4）设计增量

**日期：** 2026-09-12

**状态：** 已在对话中确认

**母设计：** `docs/superpowers/specs/2026-09-10-claude-desk-slash-commands-design.md`

**目标：** 完成母设计中尚未落地的 Task 2~4 —— Rust 目录 IPC、前端 `/` 补全菜单、`/model` `/config` `/permissions` 原生命令路由 —— 让输入 `/` 即可发现并执行当前项目的 Skill 与 CLI 内置命令，行为与 CLI 一致。

## 1. 背景

Task 1（Bridge 层）已随 commit 53c1e69 落地：`commands.list` 请求通过 Agent SDK `supportedCommands()` / `supportedModels()` 获取真实目录，`local_command_output` 与 `commands_changed` 事件归一化已就绪。前端输入 `/` 无任何反应，因为 Rust IPC 与前端界面尚未实现。

母设计定稿后，仓库新增了**应用级**设置（commit f9daa04）：权限模式（每次询问/智能放行/全部放行，映射 `auto`/`bypassPermissions`）与应用级模型（`managed.model`）。母设计未定义任务级覆盖与这些应用级设置的关系，本增量补齐。

## 2. 已确认的产品决策

- 本次实现母设计的 Task 2、Task 3、Task 4 全部内容。
- 任务级覆盖优先于应用级设置；覆盖值为空时回落到应用级设置（「跟随应用设置」语义）。
- `/permissions` 任务级选项只含 `default | acceptEdits | plan | dontAsk`；`bypassPermissions` 与 `auto` 不进入任务级 UI，危险放行仅可通过应用级设置页（带警示）开启。
- 任务模型覆盖必须存在于该项目最新目录的 `models` 列表中。
- 不创建 Git 提交，所有改动保留在工作区。

## 3. 任务级偏好存储（Rust）

- Task 存储新增两个可空字段：`model_override: Option<String>`、`permission_mode_override: Option<String>`。
- 新 IPC：
  - `set_task_model(task_id, model)` —— `model` 为空字符串表示清除覆盖（跟随应用设置）；非空时必须命中该项目最新缓存目录的 `models[].value`，否则拒绝。
  - `set_task_permission_mode(task_id, mode)` —— 同上，空值清除；非空时只接受四个安全模式。
- `run.start` 组装优先级：
  - 模型：任务 `model_override` > 应用级 `managed.model`。任务覆盖写入 Bridge 已有的 `modelOverride` 字段（resume 会话同样生效）；应用级模型沿用现状（仅新会话生效）。
  - 权限模式：任务 `permission_mode_override` > 应用级 `settings.permission_mode`。任务覆盖直接替换 `permissionMode` 字段。
- 覆盖仅影响后续轮次，不追溯已结束的 run。

## 4. 目录 IPC 与事件（Rust）

- `list_slash_commands(project_id)`：
  1. 只接受项目 UUID，从 Storage 解析规范化项目路径，不信任前端传入的任意路径。
  2. 复用 `claude::diagnose` 得到已验证的 CLI 绝对路径。
  3. 向 Bridge 发送 `{"v":1,"type":"commands.list","requestId":"<uuid>","claudePath":"<...>","cwd":"<...>"}`。
  4. 校验返回：拒绝空命令名与空模型值，畸形项丢弃并记录诊断；整包畸形返回 `bridge_event_invalid`。
  5. 结果缓存在进程内（按项目），不写 SQLite。
- `local_command_output` → 持久化时间线事件（`TaskEventPayload::LocalCommandOutput`）。
- `commands_changed` → 替换语义更新项目缓存，并发出携带 projectId 的 `slash-commands-changed` 事件供前端刷新。

## 5. 前端 `/` 补全菜单

- `src/services/slashCommands.ts`：按项目的 Promise 缓存（并发去重、失败可重试、可按项目失效）；`filterSlashCommands(commands, query)` 对名称与别名做不区分大小写前缀匹配，名称匹配排在别名匹配之前。
- `SlashCommandMenu.vue`：`role="listbox"` 悬浮于输入框上方，选项显示 `/<name>`、描述、参数提示、别名；skill 与内置命令混排，全部来自运行时目录。加载中显示轻量状态，失败显示重试。
- `ComposerBox.vue` 键盘行为：
  - 仅当光标所在行、光标前首 token 以 `/` 开头时打开面板。
  - `ArrowUp`/`ArrowDown` 移动选中项，`Enter`/`Tab` 填入 `/<name> `（不发送），`Escape` 关闭。
  - 面板打开时 `Enter` 被面板接管；`Cmd/Ctrl+Enter` 发送与多行编辑行为保留。
  - 点击选项与键盘选择等效；焦点始终保留在 textarea。

## 6. 原生命令路由

- 仅拦截**无参数的裸命令** `/model`、`/config`、`/permissions`；带参数版本与其他任何命令（含全部 skill）逐字节原样经 `sendTurn` 交给 CLI，前端不改写别名或参数。
- `/model` 对话框：列出目录 `models`（`displayName` + 描述）+「跟随应用设置」选项；确认后调用 `set_task_model`，成功后显示所选值并关闭，失败保留对话框与错误。
- `/permissions` 对话框：四个安全模式（`default`/`acceptEdits`/`plan`/`dontAsk`，各配安全说明文案）+「跟随应用设置」；确认后调用 `set_task_permission_mode`。
- `/config`：触发 `open-settings` 事件，复用 `App.openSettings()` 打开现有原生设置视图。
- `local_command_output` 渲染为带可见 “CLI” 标记的助手样式时间线条目。
- 对话框契约：`role="dialog"`、`aria-modal="true"`、Escape 取消、关闭后焦点回到输入框；取消不产生任何外部变更，输入草稿保留。

## 7. 错误与降级

- CLI 不可用：不发起目录请求，沿用现有诊断引导；普通聊天不受影响。
- 目录请求失败/超时：面板显示重试，不禁用文本发送。
- `set_task_model`/`set_task_permission_mode` 失败：对话框保持打开并展示错误。
- 项目切换竞态：目录结果与 `slash-commands-changed` 都携带 projectId，前端只采用与当前项目一致的结果。

## 8. 测试与验收

- Bridge 侧已有测试不动（Task 1 已覆盖）。
- Rust：`list_slash_commands` 只为已索引项目发请求；缓存失效；`local_command_output`/`commands_changed` 事件映射；权限模式校验拒绝未知值；`set_task_model` 拒绝目录外模型；`run.start` 覆盖优先级（任务 > 应用）。
- 前端：缓存并发去重与失效；过滤排序规则；键盘/鼠标补全行为不改发送语义；裸 `/model` 打开对话框而不发送；skill 调用原样透传；`/config` 触发 open-settings；对话框确认/取消/错误状态。
- 本机冒烟：输入 `/` 出现含 skill 的完整目录；键盘选择填入不发送；发现的 skill 原样执行；`/help` 显示 CLI 本地输出；`/model` `/permissions` 走原生对话框；目录失败不影响普通聊天。
- 完成标准：同一项目、同一 CLI、同一设置源下，面板内容与 `supportedCommands()` 原始结果一致；skill 名称、参数、执行语义不被改写；全部改动不产生 Git 提交。
