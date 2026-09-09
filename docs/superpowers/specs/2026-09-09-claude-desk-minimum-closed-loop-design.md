# Claude Desk Minimum Closed-Loop Design

**Date:** 2026-09-09

**Status:** Approved in conversation

**Target:** Locally installable macOS and Windows desktop application

**Stack:** Tauri 2, Vue 3, TypeScript, Rust, Claude Agent SDK, locally installed Claude CLI

## 1. Purpose

Claude Desk is a small desktop shell around the user's locally installed Claude CLI. It borrows the project-and-session navigation model of Codex while preserving Claude Code's own configuration, project instructions, sessions, tools, and permission behavior.

The first release is deliberately limited to one complete loop:

1. Detect the local Claude CLI.
2. Read local Claude projects and sessions.
3. Create or resume a session.
4. Send a prompt and stream the response.
5. Display tool activity and collect permission decisions.
6. Keep multiple sessions running concurrently.
7. Read and update the selected user-level Claude environment settings.
8. Produce locally installable macOS and Windows packages.

This specification replaces the broader feature scope in the earlier Claude Desk design for the MVP implementation. Features excluded here remain future work.

## 2. Confirmed Product Decisions

### 2.1 Claude CLI dependency

- Claude Desk uses the Claude CLI installed and authenticated by the user.
- The app does not download, install, bundle, update, or authenticate Claude CLI.
- On startup, the app locates the executable and verifies it with `claude --version`.
- If detection fails, the app provides installation/login guidance and a retry action.
- Windows MVP supports a native Windows Claude CLI only. WSL integration is excluded.

### 2.2 Project and session behavior

- The sidebar is a two-level hierarchy: project, then session.
- Projects are discovered from Claude's local history and can also be added with a native folder picker.
- Existing Claude CLI sessions are shown and can be resumed.
- Sessions created in Claude Desk remain compatible with the CLI session store.
- Sessions support create, open, resume, rename, and recoverable delete.
- Session titles come from Claude session metadata unless the user renames them.
- Deletion moves the selected session's transcript and same-session companion data to the operating system trash/recycle bin after a confirmation dialog.
- Deletion never purges the entire project or modifies project source files.

### 2.3 Conversation behavior

- Responses stream into the conversation view.
- The view renders user and assistant messages, Markdown, code blocks, tool-call state, errors, and retry controls.
- The user can stop an active response.
- Tool actions that require approval are presented in Claude Desk with Allow and Deny actions.
- If a permission request loses its UI connection, times out, or the app exits, the action is denied.
- One session accepts only one active turn at a time.
- Different sessions may run concurrently without a fixed app-level concurrency limit.
- Switching projects or sessions does not interrupt running work.
- Closing the app while work is active shows a confirmation dialog. Confirming exit terminates all Claude Desk-owned Claude processes.

### 2.4 Model behavior

- New sessions use the current configured model.
- Resumed sessions preserve the model stored with that session, matching native Claude CLI behavior.
- Changing the model setting does not mutate already-running or resumed sessions.

### 2.5 User settings

Claude Desk reads and updates the user-level Claude settings file:

- macOS: `~/.claude/settings.json`
- Windows: `%USERPROFILE%\\.claude\\settings.json`

Only these values under `env` are managed in the MVP:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "...",
    "ANTHROPIC_BASE_URL": "...",
    "ANTHROPIC_MODEL": "..."
  }
}
```

Other keys and values must remain semantically unchanged. The app watches the settings file and refreshes the form after external changes. If the form has unsaved edits, an external change produces a conflict notice instead of silently replacing either version.

`ANTHROPIC_AUTH_TOKEN` is intentionally stored in `settings.json` for compatibility with the user's chosen Claude Code configuration. The field is masked by default and may be revealed temporarily. It must not be copied into UI persistence, diagnostics, or logs.

## 3. Scope

### 3.1 Included

- Claude CLI discovery, validation, and error guidance.
- Automatic project discovery from local Claude history.
- Manual addition of local project folders.
- Project/session sidebar.
- Session creation, reading, resumption, rename, and recoverable deletion.
- Streaming conversation UI.
- Markdown and fenced-code rendering.
- Tool-call progress and approval UI.
- Stop and retry behavior.
- Concurrent execution across sessions.
- Settings synchronization for the three agreed environment values.
- Claude Code-inspired dark theme.
- Unsigned macOS Apple Silicon DMG.
- Unsigned Windows x64 installer.

### 3.2 Explicitly excluded

- Embedded terminal.
- Git diff, code review, or worktree UI.
- Cloud synchronization or remote tasks.
- CLI installation, update, or in-app login.
- Auto-update and release publishing.
- Code signing, notarization, or app-store distribution.
- Light theme.
- Intel macOS, Windows ARM64, and WSL.
- MCP configuration UI.
- Full `settings.json` editor.
- Per-project settings editing.
- Search, favorites, archive, and session branching UI.
- Configurable concurrency limits or a run queue.

## 4. Experience Design

### 4.1 Visual language

The application uses one dark theme based on the supplied Claude Code reference:

- black and charcoal surfaces;
- warm white primary text;
- muted gray secondary text and borders;
- Claude orange for primary actions, selection, and active states;
- restrained shadows and no decorative gradients.

The app should feel like Claude Code presented through a focused native desktop shell, not like a generic web dashboard.

### 4.2 Sidebar

The fixed left sidebar contains:

- Claude Desk identity;
- new-session action;
- add-project action;
- collapsible project rows;
- nested session rows;
- per-session run status;
- settings entry at the bottom.

Session states shown in the sidebar are:

- idle;
- running;
- awaiting permission;
- completed;
- failed;
- interrupted.

Rename and Delete are available from a session context menu. Delete requires a second confirmation showing project, title, and last activity time.

### 4.3 Conversation area

The main area contains:

- a header with project, session title, and status;
- a scrollable transcript;
- tool-call cards embedded in chronological order;
- permission cards with Allow and Deny controls;
- an error card with retry when appropriate;
- a composer with send and stop actions;
- the effective model displayed as read-only session information.

While a turn is active in a session, its composer cannot submit a second turn. Other sessions remain usable.

### 4.4 Settings area

The settings screen contains three fields:

- masked `ANTHROPIC_AUTH_TOKEN` with a temporary reveal control;
- `ANTHROPIC_BASE_URL` with basic URL validation;
- `ANTHROPIC_MODEL` as free text so custom gateway model identifiers are supported.

It also shows the detected Claude executable path and version, with a retry-detection action.

## 5. Architecture

```text
Vue 3 + TypeScript UI
          |
       Tauri IPC
          |
Tauri / Rust desktop core
          |
   local sidecar IPC
          |
TypeScript Agent Bridge
          |
locally installed Claude CLI
```

### 5.1 Vue application

The Vue layer owns presentation state only:

- selected project/session;
- sidebar expansion;
- normalized transcript view models;
- run indicators;
- draft input;
- permission dialogs/cards;
- settings form state.

It never reads Claude files directly and never persists the auth token.

### 5.2 Tauri/Rust core

The Rust layer owns trusted desktop operations:

- Claude executable discovery and verification;
- starting and supervising Agent Bridge processes;
- routing IPC events to the correct window/session;
- filesystem watching;
- safe settings reads and writes;
- native folder selection;
- moving session data to trash/recycle bin;
- application shutdown coordination;
- redacted local diagnostics.

### 5.3 TypeScript Agent Bridge

The bridge uses `@anthropic-ai/claude-agent-sdk` and sets `pathToClaudeCodeExecutable` to the executable found by the Rust layer. The SDK's own platform CLI binary is not used for the MVP. The same compiled sidecar supports two invocation modes: short-lived catalog commands for session metadata, and a long-lived run worker for one active Claude turn.

The bridge owns:

- `query()` lifecycle and stream consumption;
- new and resumed session options;
- `AbortController` cancellation;
- conversion of SDK messages into a small versioned IPC event schema;
- `canUseTool` permission callbacks;
- session enumeration and transcript reads;
- SDK-backed session metadata and rename operations.

Each active turn receives its own run-worker process. This isolates failures between concurrently running sessions and gives Rust an unambiguous process to stop. The bridge is compiled as a platform-specific standalone sidecar, so end users do not need Node.js or Bun. Separate binaries are produced for macOS arm64 and Windows x64.

### 5.4 Why this architecture

The Agent SDK exposes the programmatic primitives required by the MVP—streaming, cancellation, permission callbacks, session enumeration, transcript reads, and renaming—while still using Claude Code's filesystem settings and session format. Keeping those semantics in a narrow sidecar avoids reimplementing Claude's event protocol in Rust and keeps privileged operating-system work in Tauri.

## 6. Runtime Data Flow

### 6.1 Startup

1. Rust checks PATH and platform-specific common locations for `claude`.
2. Rust runs `claude --version` with a timeout.
3. Rust runs an Agent Bridge handshake and supplies the verified path.
4. Rust reads and watches the user settings file.
5. Rust invokes the bridge's catalog command to enumerate Claude sessions and return normalized project/session summaries.
6. Vue renders the last selected session or an empty state.

### 6.2 New session

1. The user selects a project and submits a prompt.
2. Vue sends `run.start` with a client-generated run ID, project path, and prompt.
3. Rust starts a dedicated bridge run worker for the turn.
4. The worker starts `query()` with the project as `cwd` and the detected CLI path.
5. The SDK initialization event supplies the persistent Claude session ID.
6. The provisional UI entry is reconciled with that session ID.
7. Stream events are normalized, tagged with both IDs, and routed to Vue.
8. On completion, the session list and metadata are refreshed.

### 6.3 Resume session

1. The user opens an existing session and submits a prompt.
2. Rust starts a dedicated bridge run worker, which calls `query()` with the stored session ID as `resume`.
3. No model override is passed, preserving Claude CLI's session model behavior.
4. Events follow the same path as a new session.

### 6.4 Permission request

1. The SDK invokes the bridge's permission callback.
2. The bridge emits a permission request with a unique request ID, tool name, and structured input.
3. Vue renders a permission card.
4. Allow returns the unmodified input; Deny returns a concise user-facing reason.
5. Disconnect, timeout, shutdown, or missing request state resolves as Deny.

### 6.5 Stop and shutdown

- Stop aborts only the selected session's active SDK query.
- Unexpected run-worker exit marks only its owning run as interrupted.
- App shutdown blocks while a confirmation dialog is open.
- Confirmed shutdown first denies outstanding permissions, then aborts queries, then terminates remaining child processes with a bounded grace period.

## 7. Process and State Model

Rust maintains a registry keyed by active run ID. Each entry contains:

- Claude session ID when known;
- project path;
- bridge process/channel;
- current lifecycle state;
- pending permission request IDs;
- start timestamp;
- last event timestamp.

Every event includes a protocol version, run ID, optional session ID, sequence number, and payload. Vue ignores stale events whose run ID no longer matches the active run for that session.

There is no global concurrency cap. Resource usage is user-controlled. The app prevents duplicate simultaneous turns for the same session because Claude transcripts can interleave if one session ID is resumed by multiple processes.

## 8. Settings Synchronization

### 8.1 Read behavior

- Missing file is treated as an empty object.
- Valid JSON is parsed into a generic object.
- Only `env.ANTHROPIC_AUTH_TOKEN`, `env.ANTHROPIC_BASE_URL`, and `env.ANTHROPIC_MODEL` are projected into the UI.
- Invalid JSON produces a blocking settings error and is never overwritten.

### 8.2 Write behavior

1. Re-read the current file immediately before save.
2. Detect whether it changed since the form snapshot.
3. If changed and the form is dirty, show a conflict instead of saving.
4. Merge only the three managed keys into the latest object.
5. Create a timestamped backup.
6. Write a temporary file in the same directory.
7. Flush and atomically replace the target where supported.
8. Apply restrictive user-only file permissions where the platform supports them.
9. Re-read and verify the saved values.

Empty values remove their individual keys. An empty `env` object may remain; unrelated keys are never removed.

### 8.3 Watch behavior

- The watcher debounces filesystem events.
- Clean forms refresh automatically.
- Dirty forms retain their edits and show an external-change warning.
- Self-generated write events are reconciled by content version rather than assumed to be external changes.

## 9. Session Mutation and Deletion

- Rename uses the Agent SDK session rename API and refreshes the session summary after success.
- Delete is disabled for an actively running session.
- A delete plan is resolved from the exact project key and session ID before confirmation.
- Only exact, validated paths beneath Claude's application-data directories may be moved.
- The main transcript and exact same-session companion directories are sent to the OS trash/recycle bin.
- Failure is reported per path; the UI refreshes from disk rather than assuming success.
- Claude Desk does not implement restore UI. Recovery is performed through the operating system's trash/recycle bin.

## 10. Failure Handling

### 10.1 CLI failures

- Missing CLI: setup state with guidance and retry.
- Version check timeout: failed detection with copyable diagnostics.
- Authentication/gateway error: keep the draft and offer retry.
- Non-zero process exit: map known failure categories and retain redacted raw diagnostics.

### 10.2 Bridge and stream failures

- Unknown event types are logged and ignored.
- Malformed individual events do not terminate the UI.
- A run-worker crash marks only its owning run interrupted and supports a fresh retry.
- A retry resumes only when a durable session ID exists; otherwise it creates a new turn from the retained prompt.

### 10.3 Data failures

- Malformed transcript lines are skipped for display and never rewritten.
- A damaged session remains visible with an error marker when its basic metadata can be recovered.
- Settings parse errors block writes.
- Token and common secret fields are redacted before logging or display in diagnostics.

## 11. Packaging

### 11.1 macOS

- Build host: Apple Silicon macOS.
- Target: `aarch64-apple-darwin`.
- Bundle: unsigned DMG.
- Expected artifact: `artifacts/ClaudeDesk_<version>_aarch64.dmg`.
- Gatekeeper warnings are documented because signing and notarization are out of scope.

### 11.2 Windows

- Build host: native Windows x64 or a Windows CI runner.
- Target: `x86_64-pc-windows-msvc`.
- Bundle: unsigned NSIS setup executable.
- Expected artifact: `artifacts/ClaudeDesk_<version>_x64-setup.exe`.
- SmartScreen warnings are documented because signing is out of scope.

### 11.3 Build policy

- Builds are manual local builds or manually triggered CI jobs.
- No release is created and artifacts are not published automatically.
- Each platform bundles its matching compiled Agent Bridge sidecar.
- Packaging verifies that the bridge is executable and that the app handles a missing user-installed Claude CLI cleanly.

## 12. Testing Strategy

### 12.1 Unit tests

- Settings parsing, three-key merge, deletion, backup, and redaction.
- macOS and Windows path normalization and target validation.
- SDK-to-UI event normalization.
- Run/session state transitions.
- Permission allow, deny, disconnect, and timeout behavior.
- Same-session duplicate-run prevention.
- Shutdown ordering.

### 12.2 Integration tests

A deterministic fake Claude executable is used to exercise:

- CLI detection;
- new-session initialization;
- stream parsing;
- resumed sessions;
- tool requests;
- user approval and denial;
- cancellation;
- non-zero exits;
- malformed events;
- two or more simultaneous sessions.

These tests do not require credentials and do not consume API quota.

Filesystem fixtures cover existing Claude project/session structures, corrupt JSONL lines, external settings edits, and recoverable session deletion.

### 12.3 Manual smoke tests

- A real locally authenticated Claude CLI on macOS arm64.
- A real locally authenticated native Claude CLI on Windows x64.
- Custom `ANTHROPIC_BASE_URL`, auth token, and model.
- Installer launch, first-run detection, and uninstall behavior.

## 13. Acceptance Criteria

The MVP is complete only when all of the following are demonstrated:

1. The app detects an installed Claude CLI and handles a missing CLI without crashing.
2. Existing projects and sessions appear in the sidebar.
3. A user can add a local project folder.
4. A new session streams a real Claude response.
5. An existing CLI session can be opened and continued.
6. Tool activity is visible and a user can allow or deny a permission request.
7. The user can stop an active turn and retry a failed turn.
8. At least two sessions can run at the same time and remain active while the user switches views.
9. A session can be renamed.
10. A session can be moved to the OS trash/recycle bin after confirmation.
11. The settings form reads, watches, and safely updates the three agreed environment fields while preserving all unrelated JSON.
12. Secrets do not appear in logs or persisted frontend state.
13. Closing with active work prompts before terminating owned child processes.
14. Automated unit and fake-CLI integration tests pass.
15. The macOS arm64 DMG installs and launches on Apple Silicon.
16. The Windows x64 installer installs and launches on native Windows.

## 14. Implementation Constraints

- Preserve the user's existing Claude data and unrelated settings.
- Never infer broad deletion targets from unresolved variables or partial session identifiers.
- Do not expose filesystem or process primitives directly to the Vue webview.
- Keep the bridge protocol small, versioned, and independent of raw SDK event shapes.
- Treat Claude transcript structures as external data that may gain fields over time.
- Do not broaden the MVP while implementing it. New feature requests require a separate design update.

## 15. References

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code session management](https://code.claude.com/docs/en/sessions)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
