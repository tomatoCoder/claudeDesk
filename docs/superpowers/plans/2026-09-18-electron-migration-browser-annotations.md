# Claude Desk Electron Migration Implementation Plan

> **For agentic workers:** Execute tasks in order. This project explicitly forbids adding, modifying, or running tests unless the user later authorizes them. Do not create commits unless explicitly requested.

**Goal:** Replace Tauri/Rust with Electron/Node.js/TypeScript while preserving all existing behavior and user data, then rebuild the browser annotation workflow with `WebContentsView`.

**Architecture:** Keep the Vue renderer and its `DesktopPlatform` contract. Add a sandboxed Electron main/preload boundary, migrate Rust capabilities into focused TypeScript modules, reuse the existing TypeScript Claude Bridge, and delete Tauri only after macOS and Windows parity is complete.

**Tech Stack:** Electron, Vue 3, TypeScript, Vite, Pinia, SQLite, Node.js child processes, Electron Builder.

**Spec:** `docs/superpowers/specs/2026-09-18-electron-migration-browser-annotations-design.md`

## Global Constraints

- Final production artifacts contain no Rust or Tauri runtime.
- Existing `claude-desk.db`, schema version 2, settings, projects, tasks, events, and Claude session links remain readable without manual import.
- macOS and Windows are first-class release targets; Linux is out of scope.
- Renderer processes use `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Remote browser content receives only the annotation-specific preload contract.
- Do not add, modify, or run automated tests unless the user explicitly authorizes it.
- Do not create git commits unless the user explicitly requests them.
- Type checks, builds, database-copy inspection, and manual smoke checks are allowed verification methods.

---

### Task 1: Electron shell and typed desktop bridge

**Files:**
- Create: `electron/main/index.ts`
- Create: `electron/main/window.ts`
- Create: `electron/main/ipc.ts`
- Create: `electron/preload/main.ts`
- Create: `electron/shared/contracts.ts`
- Create: `electron/tsconfig.json`
- Modify: `src/platform/desktop.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `window.claudeDeskDesktop: DesktopPlatform`
- Produces: `registerIpcHandlers(window: BrowserWindow): void`
- Produces: `createMainWindow(): BrowserWindow`

- [x] Add Electron main, preload, and shared TypeScript build entries.
- [x] Create a sandboxed `BrowserWindow` matching the current 1280×820 and 960×640 minimum dimensions.
- [x] Expose explicit `invoke`, `listen`, and `openFiles` wrappers from preload without exposing `ipcRenderer`.
- [x] Route development to `http://localhost:1420` and production to the built renderer.
- [x] Replace Tauri-specific Vite environment and watch exclusions with Electron equivalents.
- [x] Add development and build scripts while leaving old Tauri scripts temporarily available.
- [x] Run TypeScript checking and an Electron main/preload build; do not run tests.

### Task 2: Application paths, database backup, and schema-compatible storage

**Files:**
- Create: `electron/main/app-paths.ts`
- Create: `electron/main/database/migrations.ts`
- Create: `electron/main/database/storage.ts`
- Create: `electron/main/database/backup.ts`
- Create: `electron/main/database/rows.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `resolveAppPaths(): AppPaths`
- Produces: `openStorage(path: string): Storage`
- Produces: repositories for projects, tasks, events, and app settings using current DTO shapes.

- [x] Map Tauri's existing app-data location before considering Electron's default `userData` directory.
- [x] Open schema version 2 without changing table or column names.
- [x] Reproduce `projects`, `tasks`, `events`, and `settings` repository behavior and ordering.
- [x] Back up an existing database before any future schema change.
- [x] Reproduce interrupted-task recovery without replaying work.
- [x] Register snapshot, project, task, event, and app-settings IPC commands.
- [ ] Inspect a copied database and run type/build verification; do not use the user's live database for destructive checks.

### Task 3: Claude settings and session catalog

**Files:**
- Create: `electron/main/settings/claude-settings.ts`
- Create: `electron/main/claude/locator.ts`
- Create: `electron/main/claude/version.ts`
- Create: `electron/main/claude/bridge-client.ts`
- Create: `electron/main/sessions/catalog.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces: `locateClaude(): Promise<string>`
- Produces: `runBridgeRequest(request): Promise<BridgeEvent[]>`
- Produces current settings and session catalog IPC commands.

- [x] Port Claude executable discovery and version diagnostics for macOS and Windows.
- [x] Spawn the existing built TypeScript Bridge with newline-delimited JSON.
- [x] Port Claude settings load/save while preserving unmanaged JSON keys.
- [x] Port session list, message retrieval, rename, and catalog synchronization.
- [x] Map native and Bridge errors to the shared `AppError` contract.
- [x] Verify with type/build checks and a read-only CLI diagnostic.

### Task 4: Task coordinator, streaming runs, cancellation, and queue

**Files:**
- Create: `electron/main/tasks/coordinator.ts`
- Create: `electron/main/tasks/active-run.ts`
- Create: `electron/main/tasks/turn-queue.ts`
- Create: `electron/main/tasks/event-mapper.ts`
- Modify: `electron/main/claude/bridge-client.ts`
- Modify: `electron/main/database/storage.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces: `TaskCoordinator` with send, submit, cancel, queue CRUD, adjust, and shutdown operations.
- Emits: existing task update and task event names consumed by Vue.

- [x] Port the Rust coordinator state machine and allowed task transitions.
- [x] Persist Bridge events before emitting them to the renderer.
- [x] Support stop, adjustment receipts, queued turns, and immediate queued sends.
- [x] Prevent multiple active runs for one task.
- [x] Shut down complete child-process trees on app exit on both target platforms.
- [x] Preserve active-task exit confirmation behavior.
- [ ] Verify manually with one disposable project and build/type checks.

### Task 5: Permission and question workflow

**Files:**
- Create: `electron/main/permissions/coordinator.ts`
- Create: `electron/main/permissions/contracts.ts`
- Modify: `electron/main/tasks/coordinator.ts`
- Modify: `electron/main/claude/bridge-client.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces: `resolvePermission(taskId, requestId, decision, updatedInput, permissionUpdate)`.
- Consumes: Bridge `permission.requested` and `question.requested` events.

- [x] Track pending permission requests by active run and request ID.
- [x] Validate decisions and reject stale or duplicate responses.
- [x] Forward allow/deny and question answers through the Bridge control channel.
- [x] Cancel unresolved requests when a run stops or the app exits.
- [ ] Verify permission and question cards manually without adding tests.

### Task 6: Files, attachments, clipboard, drag paths, Git, and terminal

**Files:**
- Create: `electron/main/files/service.ts`
- Create: `electron/main/files/path-policy.ts`
- Create: `electron/main/files/clipboard.ts`
- Create: `electron/main/git/service.ts`
- Create: `electron/main/system/terminal.ts`
- Modify: `electron/preload/main.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces existing file list/search/read/write and clipboard command contracts.
- Produces Git status/diff and terminal-open commands.

- [x] Port directory listing, bounded file search, preview, and write behavior.
- [x] Enforce canonical project-root containment for every project file operation.
- [x] Port clipboard file saving and drag-path retrieval.
- [x] Use the system `git` executable for repository state and diffs.
- [x] Open Terminal on macOS and the configured Windows terminal with safely escaped paths.
- [x] Verify file and Git flows against a disposable project.

### Task 7: Application settings, diagnostics, logs, and remaining system behavior

**Files:**
- Create: `electron/main/settings/app-settings.ts`
- Create: `electron/main/diagnostics/log-store.ts`
- Create: `electron/main/diagnostics/claude-diagnostic.ts`
- Create: `electron/main/system/lifecycle.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc.ts`

**Interfaces:**
- Produces existing settings and diagnostic commands.
- Produces app exit request/confirmation events.

- [x] Port log storage and diagnostics with secret redaction.
- [x] Port Claude upgrade invocation and status reporting.
- [x] Preserve sidebar-width validation and app settings defaults.
- [x] Complete graceful shutdown and forced-exit handling.
- [ ] Verify settings, diagnostics, and exit behavior manually.

### Task 8: WebContentsView browser foundation

**Files:**
- Create: `electron/main/browser/manager.ts`
- Create: `electron/main/browser/navigation-policy.ts`
- Create: `electron/main/browser/session.ts`
- Create: `electron/preload/browser.ts`
- Create: `electron/shared/browser-contracts.ts`
- Modify: `electron/main/window.ts`
- Modify: `electron/main/ipc.ts`
- Modify: `src/services/ipc.ts`
- Modify: `src/App.vue`
- Modify: `src/components/browser/BrowserPanel.vue`

**Interfaces:**
- Produces current browser open, bounds, history, refresh, annotation-mode, and close commands.
- Emits current URL, title, loading, navigation availability, and error state.

- [x] Create one persistent-partition `WebContentsView` per main window.
- [x] Map Vue's browser host rectangle into native view bounds without Tauri scale compensation.
- [x] Implement URL validation, navigation, history, reload, show, and hide.
- [x] Deny unsafe permissions and unapproved popup/custom-protocol navigation.
- [x] Preserve browser state while the panel is hidden.
- [ ] Verify localhost and HTTPS navigation manually on macOS and Windows.

### Task 9: Structured browser annotations and review loop

**Files:**
- Create: `electron/main/browser/annotations.ts`
- Create: `electron/preload/browser-annotation-runtime.ts`
- Create: `src/services/browserAnnotations.ts`
- Create: `src/components/browser/BrowserAnnotationList.vue`
- Create: `src/components/browser/BrowserAnnotationEditor.vue`
- Modify: `electron/shared/browser-contracts.ts`
- Modify: `src/components/browser/BrowserPanel.vue`
- Modify: `src/App.vue`
- Modify: `src/services/browserUrl.ts`

**Interfaces:**
- Produces: `BrowserAnnotation` from the approved design.
- Produces task-scoped add, edit, delete, clear-draft, and format-feedback operations.

- [x] Inject only element hover, selection, marker, and target-reporting behavior into the remote page.
- [x] Keep comment editing in the trusted Vue renderer.
- [x] Store multiple annotations per task in current-process state.
- [x] Restore markers after refresh only when selectors and target metadata still match reliably.
- [x] Mark unresolved annotations as stale instead of attaching them to a different element.
- [x] Generate one editable feedback message and insert it into the current draft without auto-sending.
- [ ] Verify element selection, text selection, multiple comments, task isolation, refresh, and stale targets manually.

### Task 10: macOS and Windows packaging

**Files:**
- Create: `electron-builder.yml`
- Create: `scripts/build-electron.mjs`
- Create: `scripts/verify-electron-bundle.mjs`
- Modify: `package.json`
- Reuse: `src-tauri/icons/icon.icns`
- Reuse: `src-tauri/icons/icon.ico`

**Interfaces:**
- Produces macOS arm64/x64 or universal artifacts and a Windows x64 installer.

- [x] Configure application ID `com.claudedesk.desktop` and product name `Claude Desk`.
- [x] Include the renderer, Electron main/preload build, Bridge runtime, and required production dependencies.
- [x] Preserve the historical app-data identity on both platforms.
- [x] Add macOS signing/notarization and Windows signing environment hooks without embedding credentials.
- [ ] Verify installed launches, upgrades, child-process cleanup, and data compatibility on both platforms.

### Task 11: Default-runtime cutover and Tauri/Rust removal

**Files:**
- Delete: `src-tauri/`
- Delete: Tauri-only build scripts and reproduction programs under `scripts/` and root where no longer applicable.
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/platform/desktop.ts`
- Modify: `vite.config.ts`
- Modify: `README.md`

**Interfaces:**
- Produces Electron as the only supported desktop runtime.

- [x] Confirm every existing IPC command has an Electron owner or has been intentionally removed by the approved spec.
- [x] Switch `dev`, `build`, and bundle commands to Electron.
- [x] Remove `@tauri-apps/*`, Cargo artifacts, Tauri capabilities, permissions, and obsolete platform checks.
- [x] Update setup, development, packaging, data location, and troubleshooting documentation.
- [x] Run type checks and production builds only; do not run tests without authorization.
- [ ] Complete the full manual acceptance checklist from the design document.

### Task 12: Deferred browser automation backlog

**Files:**
- Create: `docs/backlog/browser-automation.md`

**Interfaces:**
- Documents future work without adding empty production abstractions.

- [x] Record Agent click/type automation, screenshots, DOM/accessibility snapshots, CDP diagnostics, automatic reproduce/fix/verify, tabs, downloads, bookmarks, and persistent cross-page annotations.
- [x] Reference the existing BrowserManager, isolated session, and annotation contracts as extension points.
- [x] State that remote pages must never receive general application IPC privileges.
