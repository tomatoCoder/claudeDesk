# Claude Desk Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-aware `/` completion, runtime Skill discovery, CLI local-output rendering, and native `/model`, `/config`, and `/permissions` flows while preserving raw Claude CLI command semantics.

**Architecture:** The Bridge initializes the installed Claude CLI through the Agent SDK and returns its `supportedCommands()` and `supportedModels()` data. Rust validates project and executable paths, exposes a typed Tauri command, and stores explicit per-task model/permission overrides. Vue caches catalogs by project, renders an accessible completion list, and routes only the three confirmed interactive commands to native UI; all other command text remains unchanged.

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri 2, Rust, Claude Agent SDK 0.3.266.

**Spec:** `docs/superpowers/specs/2026-09-10-claude-desk-slash-commands-design.md`

## Global Constraints

- Runtime command data comes only from the current CLI through Agent SDK `supportedCommands()`; do not scan Skill folders or hardcode a fallback catalog.
- The Bridge uses the same absolute CLI path, project cwd, and `user`/`project`/`local` setting sources as a real turn.
- Skill and ordinary slash-command text is passed unchanged through `send_turn`.
- Commands requiring unsupported terminal-only interaction surface a clear compatibility state.
- User parameters never pass through a shell.
- `/permissions` never silently widens privileges; only an explicit user selection changes the per-task SDK permission mode.
- Ordinary chat remains usable when command discovery fails.
- Do not create Git commits for this implementation, per the user's explicit request.

---

### Task 1: Bridge command discovery and local command events

**Files:**
- Create: `bridge/src/commands.ts`
- Create: `bridge/src/commands.test.ts`
- Modify: `bridge/src/protocol.ts`
- Modify: `bridge/src/protocol.test.ts`
- Modify: `bridge/src/agent-adapter.ts`
- Modify: `bridge/src/agent-adapter.test.ts`
- Modify: `bridge/src/main.ts`

**Interfaces:**
- Consumes: `buildQueryOptions(context: QueryContext): Options`, Agent SDK `query()`, `Query.supportedCommands()`, `Query.supportedModels()`, and `Query.close()`.
- Produces: `CommandsRequest`, `normalizeCommandCatalog(commands, models): CommandCatalog`, `commands.result`, `local_command_output`, and `commands.changed` Bridge events.

- [ ] **Step 1: Write failing Bridge protocol and normalization tests**

```ts
it('accepts a commands.list request with a project cwd', () => {
  expect(parseBridgeRequest(JSON.stringify({
    v: 1, type: 'commands.list', requestId: 'r1',
    claudePath: '/usr/local/bin/claude', cwd: '/workspace',
  }))).toMatchObject({ type: 'commands.list', cwd: '/workspace' })
})

it('normalizes commands, aliases, and models without inventing values', () => {
  expect(normalizeCommandCatalog(
    [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
    [{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced' }],
  )).toEqual({
    commands: [{ name: 'review', description: 'Review code', argumentHint: '<path>', aliases: ['rv'] }],
    models: [{ value: 'sonnet', displayName: 'Sonnet', description: 'Balanced', resolvedModel: null }],
  })
})
```

- [ ] **Step 2: Run `pnpm bridge:test -- commands.test.ts protocol.test.ts agent-adapter.test.ts` and verify failures name the missing request, normalizer, and event cases**

- [ ] **Step 3: Implement the catalog contract and one-shot discovery**

```ts
export interface CommandCatalog {
  commands: Array<{ name: string; description: string; argumentHint: string; aliases: string[] }>
  models: Array<{ value: string; displayName: string; description: string; resolvedModel: string | null }>
}

export async function discoverCommandCatalog(
  context: QueryContext,
  createQuery = query,
): Promise<CommandCatalog> {
  const stream = createQuery({ prompt: keepInputOpen(), options: buildQueryOptions(context) })
  try {
    return normalizeCommandCatalog(await stream.supportedCommands(), await stream.supportedModels())
  } finally {
    stream.close()
  }
}
```

`main.ts` handles `commands.list` as a one-shot request and always calls `finishOneShot()` after writing either `commands.result` or the existing redacted `bridge.error` event.

- [ ] **Step 4: Extend SDK message normalization**

```ts
| { type: 'local_command_output'; content: string }
| { type: 'commands.changed'; commands: NormalizedSlashCommand[] }
```

Map `system/local_command_output` to its text content and `system/commands_changed` to a replace-semantics normalized array.

- [ ] **Step 5: Run `pnpm bridge:test` and `pnpm bridge:typecheck`; verify all Bridge tests pass**

---

### Task 2: Rust catalog IPC and explicit task preferences

**Files:**
- Create: `src-tauri/src/commands/slash_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/task/coordinator.rs`
- Modify: `src-tauri/src/bridge/mod.rs`
- Modify: `src-tauri/tests/bridge_event_mapping.rs`
- Create: `src-tauri/tests/slash_commands.rs`

**Interfaces:**
- Consumes: `Storage::get_project`, `Storage::get_task`, `claude::diagnose`, `bridge::request`, and Bridge protocol v1.
- Produces: `list_slash_commands(project_id) -> SlashCommandCatalogDto`, `set_task_model(task_id, model)`, `set_task_permission_mode(task_id, mode)`, plus `TaskEventPayload::LocalCommandOutput` and `TaskEventPayload::CommandsChanged`.

- [ ] **Step 1: Write failing Rust mapping tests**

```rust
#[test]
fn maps_local_command_output_to_a_timeline_event() {
    let value = serde_json::json!({"type":"local_command_output","content":"Available commands"});
    assert!(matches!(event_to_payload(&value).unwrap(),
        Some(TaskEventPayload::LocalCommandOutput { content }) if content == "Available commands"));
}

#[test]
fn validates_permission_modes_without_allowing_unknown_values() {
    assert_eq!(parse_permission_mode("plan").unwrap(), PermissionMode::Plan);
    assert!(parse_permission_mode("root").is_err());
}
```

- [ ] **Step 2: Run targeted Cargo tests and verify the new variants/functions are missing**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test bridge_event_mapping --test slash_commands`

- [ ] **Step 3: Add typed DTOs and Bridge parsing**

```rust
pub struct SlashCommandDto { pub name: String, pub description: String, pub argument_hint: String, pub aliases: Vec<String> }
pub struct ModelInfoDto { pub value: String, pub display_name: String, pub description: String, pub resolved_model: Option<String> }
pub struct SlashCommandCatalogDto { pub commands: Vec<SlashCommandDto>, pub models: Vec<ModelInfoDto> }
```

Reject empty names/model values and return `bridge_event_invalid` for malformed catalog payloads.

- [ ] **Step 4: Implement Tauri commands with trusted-path resolution**

`list_slash_commands` accepts only a project UUID, resolves its canonical path from `Storage`, diagnoses the configured CLI, and sends:

```json
{"v":1,"type":"commands.list","requestId":"<uuid>","claudePath":"<diagnosed absolute path>","cwd":"<stored project path>"}
```

`set_task_model` accepts only model values present in the latest catalog for that task's project. `set_task_permission_mode` accepts `default`, `acceptEdits`, `plan`, or `dontAsk`; it intentionally excludes `bypassPermissions` and `auto` from the first native UI.

- [ ] **Step 5: Apply overrides only when explicitly selected**

Extend `RunStartRequest` with optional `model` and `permissionMode`. A restored task gets no model field unless the task-specific override exists. `buildQueryOptions` applies an explicit model together with `resume`, and defaults permission mode to `default` only when no override exists.

- [ ] **Step 6: Map live command events**

`local_command_output` becomes a persisted timeline event. `commands.changed` updates the project catalog cache with replace semantics and emits `slash-commands-changed` carrying the project ID so Vue can refresh.

- [ ] **Step 7: Register commands and run Rust verification**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

---

### Task 3: Frontend catalog cache and accessible completion menu

**Files:**
- Create: `src/services/slashCommands.ts`
- Create: `src/services/slashCommands.spec.ts`
- Create: `src/components/conversation/SlashCommandMenu.vue`
- Create: `src/components/conversation/SlashCommandMenu.spec.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/components/conversation/ComposerBox.vue`
- Create: `src/components/conversation/ComposerBox.spec.ts`

**Interfaces:**
- Consumes: `ipc.listSlashCommands(projectId): Promise<SlashCommandCatalogDto>`.
- Produces: `loadSlashCommandCatalog(projectId, force?)`, `invalidateSlashCommandCatalog(projectId)`, and Composer emits `send(text)` or `interactive(command)`.

- [ ] **Step 1: Write failing cache and filtering tests**

```ts
it('deduplicates concurrent loads per project and can invalidate one project', async () => {
  const first = loadSlashCommandCatalog('p1')
  const second = loadSlashCommandCatalog('p1')
  expect(first).toBe(second)
  await first
  invalidateSlashCommandCatalog('p1')
  expect(loadSlashCommandCatalog('p1')).not.toBe(first)
})

it('ranks command-name prefixes before alias prefixes', () => {
  expect(filterSlashCommands(commands, 're').map((item) => item.name)).toEqual(['review', 'inspect'])
})
```

- [ ] **Step 2: Run targeted Vitest files and verify failures are caused by missing catalog/menu behavior**

Run: `pnpm test -- src/services/slashCommands.spec.ts src/components/conversation/SlashCommandMenu.spec.ts src/components/conversation/ComposerBox.spec.ts`

- [ ] **Step 3: Add frontend DTOs, IPC, and per-project promise cache**

```ts
export interface SlashCommandDto { name: string; description: string; argumentHint: string; aliases: string[] }
export interface ModelInfoDto { value: string; displayName: string; description: string; resolvedModel: string | null }
export interface SlashCommandCatalogDto { commands: SlashCommandDto[]; models: ModelInfoDto[] }
```

Cache the in-flight/resolved Promise by project ID. On rejection, delete that entry so Retry performs a real request.

- [ ] **Step 4: Build `SlashCommandMenu`**

Render a `role="listbox"` above the composer. Options show `/<name>`, aliases, description, and argument hint as plain Vue text. Expose active option state and emit a selected command on click.

- [ ] **Step 5: Integrate keyboard behavior in `ComposerBox`**

Open only when the first token at the caret starts with `/`. `ArrowUp`/`ArrowDown` updates the active item, `Enter`/`Tab` inserts `/<name> ` without sending, and `Escape` closes. Preserve Cmd/Ctrl+Enter sending and ordinary multiline behavior.

- [ ] **Step 6: Run targeted and full frontend tests**

Run: `pnpm test -- src/services/slashCommands.spec.ts src/components/conversation/SlashCommandMenu.spec.ts src/components/conversation/ComposerBox.spec.ts`

Run: `pnpm typecheck`

---

### Task 4: Native routing for `/model`, `/config`, and `/permissions`

**Files:**
- Create: `src/components/conversation/SlashCommandDialog.vue`
- Create: `src/components/conversation/SlashCommandDialog.spec.ts`
- Modify: `src/components/conversation/ConversationView.vue`
- Modify: `src/components/conversation/ConversationView.spec.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `SlashCommandCatalogDto.models`, `ipc.setTaskModel`, `ipc.setTaskPermissionMode`, and App's existing settings view.
- Produces: `ConversationView` event `open-settings`; task-local model and permission selection dialogs; raw pass-through for every non-adapted command.

- [ ] **Step 1: Write failing routing tests**

```ts
it('passes a Skill invocation through without rewriting it', async () => {
  await composer.vm.submit('/review src/main.ts')
  expect(wrapper.emitted('send')?.[0]).toEqual(['/review src/main.ts'])
})

it('opens the model dialog instead of sending bare /model', async () => {
  await composer.vm.submit('/model')
  expect(wrapper.find('[role="dialog"]').text()).toContain('选择模型')
  expect(wrapper.emitted('send')).toBeUndefined()
})

it('routes bare /config to the existing native settings view', async () => {
  await composer.vm.submit('/config')
  expect(wrapper.emitted('open-settings')).toHaveLength(1)
})
```

- [ ] **Step 2: Run `pnpm test -- src/components/conversation/SlashCommandDialog.spec.ts src/components/conversation/ConversationView.spec.ts` and verify the routing tests fail**

- [ ] **Step 3: Implement the generic native dialog**

The dialog traps interaction inside its option list, labels itself with `role="dialog"` and `aria-modal="true"`, supports Escape cancellation, and restores composer focus on close.

- [ ] **Step 4: Implement exact-token routing**

Only bare `/model`, `/config`, and `/permissions` are intercepted. Commands containing explicit arguments and every other slash command remain byte-for-byte unchanged after the existing outer trim.

- [ ] **Step 5: Implement model and permission selections**

`/model` displays only SDK-returned models and calls `set_task_model`. `/permissions` displays the four Rust-accepted modes with clear safety descriptions and calls `set_task_permission_mode`. On success, show the selected value in the dialog status and close; on failure, keep the dialog open with the error.

- [ ] **Step 6: Wire `/config` to `App.openSettings()` and refresh catalogs on `slash-commands-changed`**

- [ ] **Step 7: Render `local_command_output` as an assistant-style timeline item with a visible “CLI” label**

- [ ] **Step 8: Run component tests, full frontend tests, and typecheck**

Run: `pnpm test`

Run: `pnpm typecheck`

---

### Task 5: Integrated verification and documentation alignment

**Files:**
- Modify only if verification finds a failing behavior: files already listed above.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: a verified desktop feature with no Git commit.

- [ ] **Step 1: Build the Bridge and run all automated suites**

Run: `pnpm bridge:build:dev`

Run: `pnpm bridge:test`

Run: `pnpm test`

Run: `pnpm build`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 2: Run `git diff --check` and inspect `git status --short` to ensure only intended uncommitted files remain**

- [ ] **Step 3: Launch the desktop app and smoke-test the confirmed flows**

Verify `/` opens the catalog; keyboard selection inserts without sending; a discovered Skill runs unchanged; `/help` shows CLI output; `/model` and `/permissions` use native dialogs; `/config` opens settings; catalog failure does not disable chat.

- [ ] **Step 4: If a smoke test fails, first add a focused failing regression test, then implement the smallest fix and rerun the affected suite**

