# 运行中消息队列与“调整方向” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claude Desk 中复刻 Codex 的运行中消息队列：普通发送进入等待栏，用户可选择“调整方向”实时注入当前 Claude 任务，正常完成后按 FIFO 自动续跑。

**Architecture:** 前端始终调用统一的 `submit_turn`，由 Rust 协调器原子决定立即启动或进入内存 FIFO。运行任务通过专属 Tokio 控制通道把 `run.adjust` 发送给 Bridge；Bridge 使用可推送的 `AsyncIterable<SDKUserMessage>` 保持 Claude Agent SDK 流式输入，并以 `priority: "now"` 注入调整消息。等待队列由 Rust 持有并通过 Tauri 事件同步到前端，应用退出时释放。

**Tech Stack:** Tauri 2、Rust 1.88、Tokio、Vue 3、TypeScript 5.9、Pinia、Vitest、Claude Agent SDK 0.3.266、pnpm 11

**Spec:** `docs/superpowers/specs/2026-09-10-running-message-queue-and-steering-design.md`

## Global Constraints

- 主发送按钮保持普通发送，不改名为“立即调整”。
- “调整方向”必须使用同一 Claude 进程、同一 `runId` 和 SDK `priority: "now"`。
- 等待队列按任务隔离，并保持 FIFO；仅 `completed` 自动续跑，`failed` 和 `interrupted` 不自动执行。
- `awaiting_permission` 可排队，但必须同时在前端和后端禁用“调整方向”。
- 队列仅在当前应用进程内保存，不新增数据库迁移。
- 所有 Prompt 都拒绝空白内容和超过 200,000 字符的内容。
- 保留当前工作区未提交的 Logo、侧边栏和斜杠命令功能；修改 `bridge/src/main.ts`、`bridge/src/protocol.ts` 及其测试时必须合并现有 `commands.list` 逻辑，不得回退。
- macOS 和 Windows 共用同一 IPC 与 Bridge 代码路径，不引入平台专属队列实现。

---

## 文件结构

### 新建

- `bridge/src/run-input.ts`：唯一负责 SDK 用户消息构造、异步输入缓冲、关闭和运行中调整入队。
- `bridge/src/run-input.test.ts`：验证初始消息、`priority: "now"`、FIFO 和关闭行为。
- `src-tauri/src/task/turn_queue.rs`：纯内存、按任务隔离的 FIFO 模型，提供领取和原位恢复语义。
- `src/components/conversation/QueuedTurnList.vue`：等待消息行、调整、删除和行内编辑 UI。
- `src/components/conversation/QueuedTurnList.spec.ts`：等待消息视觉和交互测试。
- `src/services/queuedTurns.ts`：订阅并校验 `queued-turns-changed` Tauri 事件。
- `src/services/queuedTurns.spec.ts`：验证队列事件载荷和任务归属。

### 修改

- `bridge/src/protocol.ts`：定义并解析 `run.adjust`、`run.stop` 和 `permission.resolve` 控制消息。
- `bridge/src/protocol.test.ts`：覆盖调整控制消息校验，同时保留现有 `commands.list` 测试。
- `bridge/src/main.ts`：把单字符串 Query 改为流式输入，发送调整确认/拒绝事件并正确关闭控制循环。
- `src-tauri/src/domain.rs`：增加 `QueuedTurnDto`、`TurnSubmission` 和队列快照事件 DTO。
- `src-tauri/src/task/mod.rs`：导出队列模块。
- `src-tauri/src/task/coordinator.rs`：统一提交、队列操作、Bridge 调整通道、自动续跑和竞态处理。
- `src-tauri/src/commands/tasks.rs`：公开提交、读取、编辑、删除、调整和立即发送命令。
- `src-tauri/src/lib.rs`：注册新增 Tauri 命令。
- `src-tauri/tests/bridge_protocol.rs`：验证调整确认协议。
- `src/domain/models.ts`：增加前端队列和提交结果类型。
- `src/services/ipc.ts`：增加队列 IPC。
- `src/stores/runtime.ts`：维护按任务索引的队列快照。
- `src/services/taskEvents.ts`：与队列事件订阅组合或保持独立导出。
- `src/App.vue`：加载队列、组合取消订阅，并把异步操作传给会话视图。
- `src/components/conversation/ConversationView.vue`：传递队列和操作，运行时不再禁用输入框。
- `src/components/conversation/ConversationView.spec.ts`：验证等待消息不进入对话时间线。
- `src/components/conversation/ComposerBox.vue`：接入队列列表、异步提交、成功后清空和失败后保留。
- `src/components/conversation/ComposerBox.spec.ts`：验证空闲发送、运行中发送和失败保留文本。

---

### Task 1: Bridge 可推送 SDK 输入流

**Files:**
- Create: `bridge/src/run-input.ts`
- Create: `bridge/src/run-input.test.ts`
- Modify: `bridge/src/protocol.ts`
- Test: `bridge/src/protocol.test.ts`

**Interfaces:**
- Consumes: Claude Agent SDK `SDKUserMessage`；现有 Bridge 协议版本 `PROTOCOL_VERSION = 1`。
- Produces: `RunInput`, `RunControl`, `parseRunControl(line)`；Task 2/3 依赖以下 JSON：`run.adjust { runId, adjustmentId, text }`、`run.adjust.accepted`、`run.adjust.rejected`。

- [ ] **Step 1: 为控制协议写失败测试**

在 `bridge/src/protocol.test.ts` 增加以下断言，保留现有 `commands.list` 测试：

```ts
import { parseRunControl } from './protocol.js'

it('解析带调整标识的运行中指令', () => {
  expect(parseRunControl(JSON.stringify({
    v: 1,
    type: 'run.adjust',
    runId: 'run-1',
    adjustmentId: '11111111-1111-4111-8111-111111111111',
    text: '先停止修改配置，改为补测试',
  }))).toMatchObject({ type: 'run.adjust', runId: 'run-1', text: '先停止修改配置，改为补测试' })
})

it('拒绝空白的运行中调整', () => {
  expect(() => parseRunControl(JSON.stringify({
    v: 1, type: 'run.adjust', runId: 'run-1', adjustmentId: 'a1', text: '   ',
  }))).toThrow(/不能为空/)
})
```

- [ ] **Step 2: 运行协议测试并确认失败**

Run: `pnpm exec vitest run --root bridge src/protocol.test.ts`

Expected: FAIL，提示 `parseRunControl` 未导出。

- [ ] **Step 3: 实现显式控制消息解析**

在 `bridge/src/protocol.ts` 增加：

```ts
export type RunControl =
  | { v: 1; type: 'run.stop'; runId: string }
  | { v: 1; type: 'run.adjust'; runId: string; adjustmentId: string; text: string }
  | { v: 1; type: 'permission.resolve'; runId: string; permissionId: string; behavior: 'allow' | 'deny'; updatedInput?: unknown; updatedPermissions?: unknown[]; message?: string }

export function parseRunControl(line: string): RunControl {
  const value = JSON.parse(line) as Record<string, unknown>
  if (value.v !== PROTOCOL_VERSION || typeof value.type !== 'string' || typeof value.runId !== 'string') {
    throw new Error('运行控制消息格式无效')
  }
  if (value.type === 'run.adjust') {
    if (typeof value.adjustmentId !== 'string' || !value.adjustmentId) throw new Error('调整消息缺少 adjustmentId')
    if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('调整消息不能为空')
    if (value.text.length > 200_000) throw new Error('调整消息长度超过 200,000 个字符')
  }
  if (value.type === 'permission.resolve' && (typeof value.permissionId !== 'string' || !value.permissionId)) {
    throw new Error('权限控制消息缺少 permissionId')
  }
  if (!['run.stop', 'run.adjust', 'permission.resolve'].includes(value.type)) throw new Error('未知运行控制消息')
  return value as unknown as RunControl
}
```

- [ ] **Step 4: 为异步输入流写失败测试**

创建 `bridge/src/run-input.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { RunInput } from './run-input.js'

describe('RunInput', () => {
  it('先输出初始消息，再按 FIFO 输出立即调整消息', async () => {
    const input = new RunInput('先检查项目', '00000000-0000-4000-8000-000000000001')
    const iterator = input[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ message: { content: '先检查项目' } })
    expect(input.adjust('立即改为只写测试', '00000000-0000-4000-8000-000000000002')).toBe(true)
    expect((await iterator.next()).value).toMatchObject({
      message: { content: '立即改为只写测试' }, priority: 'now', uuid: '00000000-0000-4000-8000-000000000002',
    })
  })

  it('关闭后拒绝新调整并结束迭代', async () => {
    const input = new RunInput('开始', '00000000-0000-4000-8000-000000000001')
    const iterator = input[Symbol.asyncIterator]()
    await iterator.next()
    input.close()
    expect(input.adjust('太晚了', '00000000-0000-4000-8000-000000000002')).toBe(false)
    expect(await iterator.next()).toEqual({ value: undefined, done: true })
  })
})
```

- [ ] **Step 5: 运行输入流测试并确认失败**

Run: `pnpm exec vitest run --root bridge src/run-input.test.ts`

Expected: FAIL，提示找不到 `run-input.ts`。

- [ ] **Step 6: 实现最小可推送输入流**

创建 `bridge/src/run-input.ts`，公开以下稳定接口：

```ts
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export class RunInput implements AsyncIterable<SDKUserMessage> {
  constructor(initialPrompt: string, initialId: string)
  adjust(text: string, adjustmentId: string): boolean
  close(): void
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage>
}
```

内部使用 `SDKUserMessage[]` 缓冲区和等待中的 `next()` 回调。初始消息不设置 `priority`；`adjust()` 构造 `priority: 'now'`；所有消息使用 `{ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid }`。

- [ ] **Step 7: 运行 Bridge 单元测试与类型检查**

Run: `pnpm bridge:test`

Expected: PASS。

Run: `pnpm bridge:typecheck`

Expected: PASS。

- [ ] **Step 8: 提交 Task 1**

```bash
git add bridge/src/run-input.ts bridge/src/run-input.test.ts
git add -p bridge/src/protocol.ts bridge/src/protocol.test.ts
git diff --cached --check
git commit -m "feat(bridge): add streaming run input protocol"
```

---

### Task 2: Bridge 运行中调整闭环

**Files:**
- Modify: `bridge/src/main.ts`
- Modify: `bridge/src/run-input.test.ts`
- Test: `bridge/src/protocol.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `RunInput`、`parseRunControl` 和现有 `buildQueryOptions`/`normalizeSdkMessage`。
- Produces: `run.adjust.accepted { adjustmentId }`、`run.adjust.rejected { adjustmentId, reason }`；Rust 协调器据此确认或恢复等待消息。

- [ ] **Step 1: 补充控制结果生成的失败测试**

把控制分发提取为可测函数 `applyRunControl`，在 `bridge/src/run-input.test.ts` 增加：

```ts
it('把 run.adjust 推入输入流并返回 accepted', () => {
  const input = new RunInput('开始', '00000000-0000-4000-8000-000000000001')
  expect(applyRunControl(input, {
    v: 1, type: 'run.adjust', runId: 'run-1', adjustmentId: 'a1', text: '改方向',
  })).toEqual({ type: 'run.adjust.accepted', adjustmentId: 'a1' })
})
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `pnpm exec vitest run --root bridge src/run-input.test.ts`

Expected: FAIL，提示 `applyRunControl` 未导出。

- [ ] **Step 3: 在独立模块实现控制分发**

在 `bridge/src/run-input.ts` 增加：

```ts
export type AdjustmentResult =
  | { type: 'run.adjust.accepted'; adjustmentId: string }
  | { type: 'run.adjust.rejected'; adjustmentId: string; reason: string }

export function applyRunControl(input: RunInput, control: Extract<RunControl, { type: 'run.adjust' }>): AdjustmentResult {
  return input.adjust(control.text.trim(), control.adjustmentId)
    ? { type: 'run.adjust.accepted', adjustmentId: control.adjustmentId }
    : { type: 'run.adjust.rejected', adjustmentId: control.adjustmentId, reason: '当前任务已经结束' }
}
```

- [ ] **Step 4: 将 `handleRun` 改为流式输入**

在 `bridge/src/main.ts` 中保留现有 `commands.list`、目录和权限代码，并将运行部分调整为：

```ts
const runInput = new RunInput(request.prompt, randomUUID())
const nextSequence = () => ++sequence
const controlPump = consumeControls(request, pending, abortController, runInput, nextSequence)
const stream = query({ prompt: runInput, options })

for await (const sdkMessage of stream) {
  for (const event of normalizeSdkMessage(sdkMessage)) {
    write({ v: 1, ...event, requestId: request.requestId, runId: request.runId, sequence: nextSequence() })
  }
  if (isRecord(sdkMessage) && sdkMessage.type === 'result') runInput.close()
}
```

`consumeControls` 必须调用 `parseRunControl`；收到 `run.adjust` 后调用 `applyRunControl` 并写出带同一 `requestId`、`runId` 和递增 `sequence` 的确认/拒绝事件。收到 `run.stop` 时同时 `runInput.close()` 和 `abortController.abort()`。`finally` 中关闭 `RunInput`、readline 和 stdin，并等待控制循环退出，不留下 Node 进程。

- [ ] **Step 5: 运行 Bridge 全量验证**

Run: `pnpm bridge:test`

Expected: PASS，包含现有斜杠命令测试。

Run: `pnpm bridge:typecheck`

Expected: PASS。

Run: `pnpm bridge:build:dev`

Expected: PASS 并生成 `bridge/dist/main.js`。

- [ ] **Step 6: 提交 Task 2**

```bash
git add bridge/src/run-input.ts bridge/src/run-input.test.ts
git add -p bridge/src/main.ts
git diff --cached --check
git commit -m "feat(bridge): steer active Claude runs"
```

---

### Task 3: Rust 内存队列模型和 IPC 类型

**Files:**
- Create: `src-tauri/src/task/turn_queue.rs`
- Modify: `src-tauri/src/task/mod.rs`
- Modify: `src-tauri/src/domain.rs`

**Interfaces:**
- Consumes: 现有 `AppError`、`TaskStatus` 和 Tauri `AppHandle`。
- Produces: `QueuedTurnDto`, `TurnSubmission`, `QueuedTurnsChanged`, `TurnQueue`；前端和 Task 4 使用 camelCase JSON。

- [ ] **Step 1: 为 FIFO 和原位恢复写失败测试**

在新建的 `src-tauri/src/task/turn_queue.rs` 底部先写测试模块：

```rust
#[cfg(test)]
mod tests {
    use super::TurnQueue;

    #[test]
    fn keeps_fifo_per_task_and_isolates_tasks() {
        let mut queue = TurnQueue::default();
        let a1 = queue.push("task-a", "一");
        let a2 = queue.push("task-a", "二");
        queue.push("task-b", "另一任务");
        assert_eq!(queue.list("task-a"), vec![a1.clone(), a2.clone()]);
        assert_eq!(queue.take_front("task-a").unwrap().0.id, a1.id);
        assert_eq!(queue.list("task-b").len(), 1);
    }

    #[test]
    fn restores_a_claimed_turn_to_its_original_position() {
        let mut queue = TurnQueue::default();
        let first = queue.push("task-a", "一");
        queue.push("task-a", "二");
        let (claimed, index) = queue.take("task-a", &first.id).unwrap();
        queue.restore("task-a", index, claimed);
        assert_eq!(queue.list("task-a")[0].text, "一");
    }
}
```

- [ ] **Step 2: 运行 Rust 目标测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task::turn_queue --lib`

Expected: FAIL，提示 `TurnQueue` 尚未定义。

- [ ] **Step 3: 定义序列化 DTO**

在 `src-tauri/src/domain.rs` 增加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedTurnDto {
    pub id: String,
    pub task_id: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum TurnSubmission {
    Started { run_id: String },
    Queued { queued_turn: QueuedTurnDto },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedTurnsChanged {
    pub task_id: String,
    pub queued_turns: Vec<QueuedTurnDto>,
}
```

- [ ] **Step 4: 实现纯内存 `TurnQueue`**

实现以下接口，所有返回值均 clone DTO，领取操作同时返回原始索引：

```rust
#[derive(Default)]
pub struct TurnQueue { by_task: HashMap<String, VecDeque<QueuedTurnDto>> }

impl TurnQueue {
    pub fn push(&mut self, task_id: &str, text: &str) -> QueuedTurnDto;
    pub fn list(&self, task_id: &str) -> Vec<QueuedTurnDto>;
    pub fn update(&mut self, task_id: &str, id: &str, text: &str) -> Option<QueuedTurnDto>;
    pub fn take(&mut self, task_id: &str, id: &str) -> Option<(QueuedTurnDto, usize)>;
    pub fn take_front(&mut self, task_id: &str) -> Option<(QueuedTurnDto, usize)>;
    pub fn restore(&mut self, task_id: &str, index: usize, turn: QueuedTurnDto);
}
```

- [ ] **Step 5: 运行队列单元测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task::turn_queue --lib`

Expected: PASS。

- [ ] **Step 6: 运行 Rust 编译与测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: PASS。

- [ ] **Step 7: 提交 Task 3**

```bash
git add src-tauri/src/domain.rs src-tauri/src/task/mod.rs src-tauri/src/task/turn_queue.rs
git commit -m "feat(core): add queued turn model"
```

---

### Task 4: Rust 协调器实时调整和自动续跑

**Files:**
- Modify: `src-tauri/src/task/coordinator.rs`
- Modify: `src-tauri/src/task/turn_queue.rs`
- Modify: `src-tauri/src/bridge/mod.rs`
- Modify: `src-tauri/src/commands/tasks.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/bridge_protocol.rs`

**Interfaces:**
- Consumes: Task 2 的 Bridge 确认事件和 Task 3 的队列 DTO/命令。
- Produces: 线程安全的统一 `submit_turn`、队列 CRUD、实时调整、自动续跑；Tauri 事件 `queued-turns-changed`。

- [ ] **Step 1: 为终态续跑策略写失败测试**

在 `turn_queue.rs` 增加纯函数和测试：

```rust
pub fn should_auto_start(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Completed)
}

#[test]
fn only_completed_runs_auto_start_the_next_turn() {
    assert!(should_auto_start(&TaskStatus::Completed));
    assert!(!should_auto_start(&TaskStatus::Failed));
    assert!(!should_auto_start(&TaskStatus::Interrupted));
}
```

- [ ] **Step 2: 运行策略测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml only_completed_runs_auto_start_the_next_turn --lib`

Expected: FAIL，提示 `should_auto_start` 未定义。

- [ ] **Step 3: 合并运行状态和队列状态**

在 `coordinator.rs` 把单独的 `running` 改为：

```rust
struct CoordinatorState {
    running: HashMap<String, RunningTask>,
    queued_turns: TurnQueue,
}

#[derive(Clone)]
struct RunningTask {
    project_id: String,
    run_id: String,
    cancellation: CancellationToken,
    controls: tokio::sync::mpsc::UnboundedSender<RunControl>,
    sequence: Arc<AtomicU64>,
}

enum RunControl {
    Adjust {
        adjustment_id: String,
        text: String,
        reply: tokio::sync::oneshot::Sender<Result<(), AppError>>,
    },
}
```

`submit_turn` 在同一个 `state.lock()` 临界区内再次检查 `running`：存在运行则 `TurnQueue::push` 并返回 `TurnSubmission::Queued`；不存在则插入 `RunningTask` 并启动现有运行流程。诊断和项目读取可在临界区外预备，但插入前必须二次检查。

- [ ] **Step 4: 增加队列快照广播和 CRUD**

实现：

```rust
fn publish_queued_turns(&self, app: &AppHandle, task_id: &str) -> Result<(), AppError>;
pub fn list_queued_turns(&self, task_id: &str) -> Result<Vec<QueuedTurnDto>, AppError>;
pub fn update_queued_turn(&self, app: &AppHandle, task_id: &str, id: &str, prompt: String) -> Result<QueuedTurnDto, AppError>;
pub fn delete_queued_turn(&self, app: &AppHandle, task_id: &str, id: &str) -> Result<(), AppError>;
```

广播固定使用 `app.emit("queued-turns-changed", QueuedTurnsChanged { ... })`。未找到或归属错误返回 `queued_turn_not_found`，文本复用统一 `validate_prompt`。

在 `commands/tasks.rs` 添加 `submit_turn`、`list_queued_turns`、`update_queued_turn`、`delete_queued_turn`、异步 `adjust_queued_turn` 和异步 `send_queued_turn`，每个命令先调用 `validate_id`，再委托协调器。把六个命令加入 `src-tauri/src/lib.rs` 的 `generate_handler!`。命令签名固定为：

```rust
pub fn submit_turn(task_id: String, prompt: String, app: AppHandle, state: State<'_, AppState>) -> Result<TurnSubmission, AppError>;
pub fn list_queued_turns(task_id: String, state: State<'_, AppState>) -> Result<Vec<QueuedTurnDto>, AppError>;
pub fn update_queued_turn(task_id: String, queued_turn_id: String, prompt: String, app: AppHandle, state: State<'_, AppState>) -> Result<QueuedTurnDto, AppError>;
pub fn delete_queued_turn(task_id: String, queued_turn_id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError>;
pub async fn adjust_queued_turn(task_id: String, queued_turn_id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError>;
pub async fn send_queued_turn(task_id: String, queued_turn_id: String, app: AppHandle, state: State<'_, AppState>) -> Result<RunAccepted, AppError>;
```

- [ ] **Step 5: 在运行循环加入调整控制通道**

`run()` 新增 `mpsc::UnboundedReceiver<RunControl>`，在非 stopping 分支的 `tokio::select!` 中处理。收到调整后写入：

```rust
json!({
    "v": 1,
    "type": "run.adjust",
    "runId": run_id,
    "adjustmentId": adjustment_id,
    "text": text,
})
```

维护 `HashMap<String, oneshot::Sender<Result<(), AppError>>>`。收到 `run.adjust.accepted` 时完成对应 reply；收到 `run.adjust.rejected` 时以 `adjustment_rejected` 完成。运行退出前给所有未完成 reply 返回 `run_finished`。

- [ ] **Step 6: 实现调整消息的原子领取与恢复**

`adjust_queued_turn` 只允许 `Starting`/`Running`：在同一协调器锁中从队列领取指定项并 clone 当前控制发送端，然后释放锁、发送控制并等待 reply。成功时发布当前 `runId` 下的 `UserMessage` 并广播队列；失败时使用原索引 `restore`，广播恢复后的队列并返回错误。

如果完成清理先领取了该项，调整命令返回 `queued_turn_already_dispatched`；如果调整先领取但 Bridge 已结束，恢复后调用 `start_next_if_idle`，由同一项作为下一轮启动。两条路径不得同时持有该 DTO。

- [ ] **Step 7: 调整结束顺序并实现 FIFO 自动续跑**

把 `run()` 的返回类型改为 `Result<TaskStatus, AppError>`。正常终态先发布状态并返回对应 `TaskStatus`；错误路径由外层统一转换为 `Failed` 或 `Interrupted`。外层随后从 `CoordinatorState.running` 移除且校验 `run_id`、清理权限；如果终态为 `Completed`，则领取队首并调用内部 `start_claimed_turn`。`Failed`/`Interrupted` 不领取。

`send_queued_turn` 仅允许任务非活动时领取指定项；启动失败恢复原位置。成功后广播队列并返回新 `RunAccepted`。

- [ ] **Step 8: 为 Bridge 调整确认写 Rust 协议测试**

在 `src-tauri/tests/bridge_protocol.rs` 增加：

```rust
#[test]
fn decodes_adjustment_acceptance() {
    let event = decode_single_event(vec![br#"{"v":1,"type":"run.adjust.accepted","requestId":"r1","runId":"run-1","sequence":3,"adjustmentId":"a1"}\n"#.to_vec()]).unwrap();
    assert_eq!(event["type"], "run.adjust.accepted");
    assert_eq!(event["adjustmentId"], "a1");
}
```

- [ ] **Step 9: 运行 Rust 全量测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 10: 提交 Task 4**

```bash
git add src-tauri/src/task/coordinator.rs src-tauri/src/task/turn_queue.rs src-tauri/src/bridge/mod.rs src-tauri/src/commands/tasks.rs src-tauri/src/lib.rs src-tauri/tests/bridge_protocol.rs
git commit -m "feat(core): queue and steer active turns"
```

---

### Task 5: 前端队列状态与 IPC

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/services/ipc.ts`
- Create: `src/services/queuedTurns.ts`
- Modify: `src/stores/runtime.ts`
- Modify: `src/App.vue`
- Test: `src/services/queuedTurns.spec.ts`

**Interfaces:**
- Consumes: Task 3/4 的 camelCase IPC 与 `queued-turns-changed` 事件。
- Produces: `runtime.queuedTurns(taskId)`、`runtime.loadQueuedTurns(taskId)` 和 App 层异步操作函数；Task 6 UI 直接消费。

- [ ] **Step 1: 为队列事件校验写失败测试**

创建 `src/services/queuedTurns.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { isQueuedTurnsChanged } from './queuedTurns'

it('只接受任务归属明确的队列快照', () => {
  expect(isQueuedTurnsChanged({
    taskId: 'task-1',
    queuedTurns: [{ id: 'q1', taskId: 'task-1', text: '继续', createdAt: '2026-09-11T00:00:00Z' }],
  })).toBe(true)
  expect(isQueuedTurnsChanged({ taskId: 'task-1', queuedTurns: [{ id: 'q1', taskId: 'task-2' }] })).toBe(false)
})
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `pnpm vitest run src/services/queuedTurns.spec.ts`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 增加前端类型和 IPC**

在 `models.ts` 添加与 Rust 完全一致的 `QueuedTurnDto`、`TurnSubmission`、`QueuedTurnsChanged`。在 `ipc.ts` 添加：

```ts
submitTurn: (taskId: string, prompt: string) => invoke<TurnSubmission>('submit_turn', { taskId, prompt }),
listQueuedTurns: (taskId: string) => invoke<QueuedTurnDto[]>('list_queued_turns', { taskId }),
updateQueuedTurn: (taskId: string, queuedTurnId: string, prompt: string) => invoke<QueuedTurnDto>('update_queued_turn', { taskId, queuedTurnId, prompt }),
deleteQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<void>('delete_queued_turn', { taskId, queuedTurnId }),
adjustQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<void>('adjust_queued_turn', { taskId, queuedTurnId }),
sendQueuedTurn: (taskId: string, queuedTurnId: string) => invoke<RunAccepted>('send_queued_turn', { taskId, queuedTurnId }),
```

- [ ] **Step 4: 实现队列事件订阅和 Runtime 状态**

`queuedTurns.ts` 导出 `isQueuedTurnsChanged` 与 `listenToQueuedTurns`。`runtime.ts` 新增：

```ts
const queuedByTask = reactive<Record<string, QueuedTurnDto[]>>({})
async function loadQueuedTurns(taskId: string) { queuedByTask[taskId] = await ipc.listQueuedTurns(taskId) }
function replaceQueuedTurns(event: QueuedTurnsChanged) { queuedByTask[event.taskId] = event.queuedTurns }
function queuedTurns(taskId: string | null) { return taskId ? queuedByTask[taskId] ?? [] : [] }
```

- [ ] **Step 5: 在 App 生命周期接入队列**

`App.vue` 在 `onMounted` 同时订阅任务事件和队列事件；使用一个组合 unlisten 函数统一释放。hydrate 后和选中任务变化时并行加载历史事件与队列。

把原 `send` 改为返回 Promise 的 `submit`，调用 `ipc.submitTurn`。新增 `updateQueued`、`deleteQueued`、`adjustQueued`、`sendQueuedNow`；错误统一通过 `errorMessage` 显示，但函数必须重新抛出错误，让输入组件决定是否清空文本或退出编辑状态。

- [ ] **Step 6: 运行前端服务测试与类型检查**

Run: `pnpm vitest run src/services/queuedTurns.spec.ts`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 7: 提交 Task 5**

```bash
git add src/domain/models.ts src/services/ipc.ts src/services/queuedTurns.ts src/services/queuedTurns.spec.ts src/stores/runtime.ts src/App.vue
git commit -m "feat(ui): synchronize queued turns"
```

---

### Task 6: Codex 风格等待消息栏与异步发送体验

**Files:**
- Create: `src/components/conversation/QueuedTurnList.vue`
- Create: `src/components/conversation/QueuedTurnList.spec.ts`
- Create: `src/components/conversation/ComposerBox.spec.ts`
- Modify: `src/components/conversation/ComposerBox.vue`
- Modify: `src/components/conversation/ConversationView.vue`
- Modify: `src/components/conversation/ConversationView.spec.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `QueuedTurnDto`、`TaskStatus` 和 Task 5 的 Promise 操作函数。
- Produces: 参考图结构的等待消息栏；普通发送按钮不变；行级“调整方向”、删除、更多/编辑和失败后“立即发送”。

- [ ] **Step 1: 为等待消息行写失败测试**

创建 `QueuedTurnList.spec.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QueuedTurnList from './QueuedTurnList.vue'

const turns = [{ id: 'q1', taskId: 'task-1', text: '111', createdAt: '2026-09-11T00:00:00Z' }]

it('按参考图显示消息摘要和独立的调整方向操作', async () => {
  const wrapper = mount(QueuedTurnList, { props: { turns, status: 'running' } })
  expect(wrapper.get('[data-testid="queued-turn-text"]').text()).toBe('111')
  expect(wrapper.get('[data-testid="adjust-turn"]').text()).toContain('调整方向')
  expect(wrapper.find('[data-testid="composer-submit"]').exists()).toBe(false)
  await wrapper.get('[data-testid="adjust-turn"]').trigger('click')
  expect(wrapper.emitted('adjust')?.[0]).toEqual(['q1'])
})

it('失败状态显示立即发送且等待权限时禁用调整', () => {
  expect(mount(QueuedTurnList, { props: { turns, status: 'failed' } }).text()).toContain('立即发送')
  expect(mount(QueuedTurnList, { props: { turns, status: 'awaiting_permission' } }).get('[data-testid="adjust-turn"]').attributes('disabled')).toBeDefined()
})
```

- [ ] **Step 2: 运行等待消息测试并确认失败**

Run: `pnpm vitest run src/components/conversation/QueuedTurnList.spec.ts`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现等待消息列表**

`QueuedTurnList.vue` 使用 `CornerDownRight`、`Trash2`、`Ellipsis` 图标。Props 与 emits 固定为：

```ts
const props = defineProps<{ turns: QueuedTurnDto[]; status: TaskStatus; busyIds?: string[] }>()
const emit = defineEmits<{
  adjust: [id: string]
  sendNow: [id: string]
  remove: [id: string]
  update: [id: string, text: string]
}>()
```

每行单行省略；`…` 打开仅含“编辑消息”的菜单；编辑模式显示原位 textarea、保存和取消。`starting/running` 显示“调整方向”，`awaiting_permission` 显示禁用的“调整方向”，`failed/interrupted` 显示“立即发送”。队列区最大高度 168px 并内部滚动。

- [ ] **Step 4: 为 Composer 异步提交写失败测试**

创建 `ComposerBox.spec.ts`：

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ComposerBox from './ComposerBox.vue'

it('运行中仍可编辑，主按钮仍是普通发送', async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  const noop = vi.fn().mockResolvedValue(undefined)
  const wrapper = mount(ComposerBox, { props: { disabled: false, queuedTurns: [], status: 'running', submit, adjust: noop, sendNow: noop, remove: noop, update: noop } })
  await wrapper.get('textarea').setValue('111')
  expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('[data-testid="composer-submit"]').attributes('title')).toBe('发送')
  await wrapper.get('[data-testid="composer-submit"]').trigger('click')
  expect(submit).toHaveBeenCalledWith('111')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
})

it('提交失败时保留输入', async () => {
  const noop = vi.fn().mockResolvedValue(undefined)
  const wrapper = mount(ComposerBox, { props: { disabled: false, queuedTurns: [], status: 'running', submit: vi.fn().mockRejectedValue(new Error('失败')), adjust: noop, sendNow: noop, remove: noop, update: noop } })
  await wrapper.get('textarea').setValue('不要丢失')
  await wrapper.get('[data-testid="composer-submit"]').trigger('click')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('不要丢失')
})
```

- [ ] **Step 5: 运行 Composer 测试并确认失败**

Run: `pnpm vitest run src/components/conversation/ComposerBox.spec.ts`

Expected: FAIL，因为运行中 textarea 仍被禁用且组件没有 `submit` Promise prop。

- [ ] **Step 6: 实现组合式 Composer**

`ComposerBox.vue` 接受：

```ts
const props = defineProps<{
  disabled?: boolean
  status: TaskStatus
  queuedTurns: QueuedTurnDto[]
  submit: (text: string) => Promise<void>
  adjust: (id: string) => Promise<void>
  sendNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, text: string) => Promise<void>
}>()
```

`submit()` 成功后清空文本，失败时保留；提交中禁用重复点击但不改变按钮含义。占位文字固定为“随心输入”。把 `QueuedTurnList` 放在 textarea 上方、同一视觉容器内，顶部队列行使用 `#151411`、`#3a352f` 和 Claude 橙色 token，与当前深色主题融合。

停止按钮继续由 `ConversationView`/Composer footer 保留为独立方形按钮；运行中同时可以普通发送排队。

- [ ] **Step 7: 连接 ConversationView 和 App**

`ConversationView` 增加队列与 Promise 回调 props，移除 `send` emit，只保留 `stop` emit；把 App 的操作函数传入 Composer。ConversationView 的 `active` 仅用于显示停止按钮和流式状态，不再禁用输入框。

在 `ConversationView.spec.ts` 增加：运行中存在 `queuedTurns` 时能看到 `111`，但 `.message.user` 数量不因此增加；只有 `user_message` 事件才进入时间线。

- [ ] **Step 8: 运行前端测试和构建**

Run: `pnpm test`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm build`

Expected: PASS。

- [ ] **Step 9: 提交 Task 6**

```bash
git add src/components/conversation/QueuedTurnList.vue src/components/conversation/QueuedTurnList.spec.ts src/components/conversation/ComposerBox.vue src/components/conversation/ComposerBox.spec.ts src/components/conversation/ConversationView.vue src/components/conversation/ConversationView.spec.ts src/App.vue
git commit -m "feat(ui): add Codex-style queued message composer"
```

---

### Task 7: 集成回归、安装包和文档

**Files:**
- Modify: `docs/testing/platform-smoke.md`

**Interfaces:**
- Consumes: Tasks 1–6 的完整功能。
- Produces: 可安装的 macOS DMG、Windows 兼容代码路径和可复现的人工验证步骤。

- [ ] **Step 1: 更新人工冒烟清单**

在 `docs/testing/platform-smoke.md` 增加以下明确场景：

```markdown
## 运行中消息队列

1. 启动一个至少运行 30 秒的任务。
2. 运行中发送“111”，确认它出现在输入框上方且未进入对话时间线。
3. 再发送“222”，确认顺序为 111、222。
4. 对 222 点击“调整方向”，确认 222 进入右侧时间线且当前 runId 不变。
5. 删除 111，确认不会自动执行。
6. 再排队 333，让当前任务正常完成，确认 333 自动成为新一轮。
7. 排队 444 后停止任务，确认 444 保留且不会自动执行，并显示“立即发送”。
8. 两个任务并行运行并分别排队，确认消息不会串任务。
```

- [ ] **Step 2: 运行全部自动化验证**

Run: `pnpm test`

Expected: PASS。

Run: `pnpm bridge:test`

Expected: PASS。

Run: `pnpm bridge:typecheck`

Expected: PASS。

Run: `pnpm bridge:catalog-exit:test`

Expected: PASS。

Run: `pnpm bridge:sidecar:test`

Expected: PASS。

Run: `pnpm build`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 3: 构建并验证 macOS DMG**

Run: `pnpm bundle:mac`

Expected: PASS，并生成 `src-tauri/target/release/bundle/dmg/Claude Desk_0.1.0_aarch64.dmg`。

Run: `pnpm verify:mac-bundle`

Expected: PASS，Sidecar 和签名/权限检查全部通过。

- [ ] **Step 4: 检查最终差异和敏感信息**

Run: `git diff --check`

Expected: 无输出。

Run: `git diff --name-only`

Expected: 只包含实施前就存在的 Logo、侧边栏、斜杠命令等未提交改动；本功能的实现文件已经按任务提交。

Run: `rg -n "ANTHROPIC_AUTH_TOKEN\s*[=:]\s*[^\[<]" --glob '!**/target/**' --glob '!**/node_modules/**' .`

Expected: 不出现真实 Token；测试占位值必须明显为假数据。

- [ ] **Step 5: 提交 Task 7**

```bash
git add docs/testing/platform-smoke.md
git commit -m "docs: add queued turn smoke coverage"
```

---

## 完成定义

- 所有 Task 的红灯测试都曾按步骤失败，并在最小实现后转绿。
- 普通发送、排队、“调整方向”、编辑、删除、自动续跑和失败后立即发送形成闭环。
- 当前 SDK Query 能在不变更进程和 `runId` 的情况下接收 `priority: "now"`。
- 前端、Bridge、Rust 全量测试和类型检查通过。
- macOS DMG 构建并通过验证；Windows 共用代码路径无平台专属编译错误。
- 未覆盖或删除工作区中用户已有的 Logo、侧边栏和斜杠命令改动。
