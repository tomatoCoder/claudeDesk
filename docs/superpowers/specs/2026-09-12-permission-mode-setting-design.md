# 权限模式设置（Permission Mode Setting）

日期：2026-09-12
状态：已批准

## 目标

在设置页新增「权限模式」选项，控制 claudeDesk 发起 Claude 会话时的工具权限行为：

| UI 文案 | 值 | 行为 |
|---|---|---|
| 每次询问我（默认） | `default` | 危险操作弹窗询问（现有 PermissionCard 流程） |
| 智能放行 | `auto` | AI 风险分类器自动放行安全操作，高危仍弹窗 |
| 全部放行 | `bypass` | 跳过所有权限检查，全自动执行 |

## 非目标

- 不做运行中会话的实时切换（改设置只影响下一次发起的 run）
- 不暴露 `acceptEdits` / `plan` / `dontAsk`（`dontAsk` 面向无头场景，GUI 意义不大）
- 不做按项目区分的权限设置（全局 app 级设置）

## 架构决策

**存储位置：app 级设置（SQLite `settings` 表，key='app'），与 theme/language/open_with 同级。**

理由：`permissionMode` 是 SDK 会话级查询选项，不是 env var；写进 `~/.claude/settings.json` 需要造非标准顶层键，且会加剧该文件与 Claude Code CLI 的外部冲突（现有 `externalConflict` 检测会多一个冲突面）。

## 数据流

```
SettingsView.vue（下拉选择，App 区块）
  → AppSettingsDto.permissionMode
  → Tauri save_settings（SQLite 持久化）
  → 下一次 send_turn：
    TaskCoordinator::run() 读 app settings
    → run.start JSON 增加 permissionMode 字段（"auto" | "bypassPermissions"）
    → bridge buildQueryOptions() → SDK Options.permissionMode
       （bypassPermissions 时同时设 allowDangerouslySkipPermissions: true）
```

## 变更明细

### 1. Rust 数据模型（`src-tauri/src/domain.rs`）

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppPermissionMode {
    #[default]
    Default,   // 每次询问
    Auto,      // 智能放行
    Bypass,    // 全部放行
}
```

`AppSettingsDto` 增加 `#[serde(default)] pub permission_mode: AppPermissionMode`。
SQLite 存的是整个 DTO 的 JSON，旧行反序列化时自动落到 `Default`，无需迁移。

协调器序列化到 bridge 时映射：`Default → 不发字段`、`Auto → "auto"`、`Bypass → "bypassPermissions"`。

### 2. 前端类型（`src/domain/models.ts`）

`AppSettingsDto` 增加 `permissionMode: 'default' | 'auto' | 'bypass'`（camelCase，与 Rust 端 serde camelCase 对应）。

### 3. 设置 UI（`src/components/diagnostics/SettingsView.vue`）

- App 区块（theme/language/openWith 旁）加同款下拉选择器，三选项如上表
- 选「全部放行」时显示一行警示文字（替换现有静态 `permission-note` 占位）
- 文案走现有 zh-CN/en-US i18n 机制

### 4. 协调器（`src-tauri/src/task/coordinator.rs`）

`run()` 构建 `run.start` 时（model 逻辑旁边）：

```rust
let app_settings = self.storage.load_settings()?;
match app_settings.permission_mode {
    AppPermissionMode::Default => {} // 不发字段，bridge 默认 'default'
    AppPermissionMode::Auto => start["permissionMode"] = json!("auto"),
    AppPermissionMode::Bypass => start["permissionMode"] = json!("bypassPermissions"),
}
```

对新建和 resume 的 run 都生效（bridge 已有测试确认 resume 时显式设置的 permissionMode 仍会应用）。

### 5. Bridge（`bridge/src/protocol.ts`、`bridge/src/agent-adapter.ts`）

- `RunStartRequest.permissionMode` 联合类型扩展为
  `'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'auto' | 'bypassPermissions'`（与 SDK `PermissionMode` 对齐）
- `buildQueryOptions()`：`permissionMode === 'bypassPermissions'` 时额外设
  `allowDangerouslySkipPermissions: true`（SDK 强制要求，缺失会拒绝启动）

## 错误处理与边界

- 旧 DB 行无 `permission_mode` 字段 → serde default 落 `Default`，行为不变
- 值只能来自 UI 下拉，无自由文本输入，无需额外校验
- `auto` / `bypass` 模式下 SDK 不再触发 `canUseTool`，现有 PermissionCard / QuestionCard 流程不受影响（仅不再触发）；`AskUserQuestion` 的问题弹窗不受权限模式影响，仍然工作

## 测试

- **Rust**：`load_settings` 对无 `permission_mode` 的旧 JSON 反序列化为 `Default`；`save_settings` roundtrip 保留新字段；coordinator 生成的 `run.start` 含正确的 `permissionMode` 值（Default 时不发、Auto 发 "auto"、Bypass 发 "bypassPermissions"）
- **Bridge**：`buildQueryOptions` 三个新用例——`bypassPermissions` 断言 `allowDangerouslySkipPermissions === true`；`auto` 原样透传；未设置时仍为 `default`
- **Vue**：SettingsView 渲染三个选项；切换时发出对应事件；选 `bypass` 时警示文字出现
