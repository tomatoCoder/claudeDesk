# Claude Desk Files Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-style right-side Files drawer that opens from the task header or `Cmd+P`/`Ctrl+P`, filters project files, and previews source, Markdown, and images without replacing the conversation.

**Architecture:** Rust owns project-root resolution, traversal, search, file classification, size limits, and canonical-path security. Vue consumes three typed Tauri commands through a request-cached service and composes a lazy tree, read-only preview, and resizable drawer beside the existing `ConversationView`. The conversation component remains mounted while the drawer opens and closes.

**Tech Stack:** Rust 1.88, Tauri 2, Vue 3, TypeScript 5.9, Pinia, Vitest, Vue Test Utils, markdown-it, DOMPurify, highlight.js, lucide-vue-next.

**Spec:** `docs/superpowers/specs/2026-09-12-files-browser-design.md`

## Global Constraints

- The Files UI is read-only: no edit, save, rename, move, delete, Git review, staging, commit, or attachment behavior.
- `Cmd+P` on macOS and `Ctrl+P` elsewhere open/focus the drawer; modal and settings views retain keyboard priority.
- The drawer and `ConversationView` coexist; opening Files must not recreate the conversation or interrupt a running task.
- Desktop drawer width defaults to 720px and clamps to 520–960px; below 960px it overlays at `min(92vw, 720px)`.
- All renderer-supplied paths are project-relative; reject absolute paths, `..`, platform prefixes, and canonical targets outside the project.
- Preview payloads are limited to 2 MiB before and after reading; search results are capped at 200.
- Markdown rendering reuses the existing sanitized renderer; SVG must never be injected as executable HTML.
- macOS and Windows behavior must compile from the same platform-neutral Rust file APIs.

---

### Task 1: Secure Project File Listing and Preview Classification

**Files:**
- Create: `src-tauri/src/files/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/domain.rs`
- Test: `src-tauri/tests/project_files.rs`

**Interfaces:**
- Consumes: a canonical project root `&Path` and renderer-provided relative path `&str`.
- Produces: `files::list_directory(root, relative) -> Result<Vec<ProjectFileEntry>, AppError>` and `files::read_preview(root, relative) -> Result<ProjectFilePreview, AppError>`.
- Produces DTOs `ProjectFileEntry { name, path, kind, extension }`, `ProjectFileKind::{File,Directory}`, `ProjectFilePreview { path, kind, mime_type, content, bytes, size }`, and `ProjectFilePreviewKind::{Text,Image,Binary,TooLarge}`.

- [ ] **Step 1: Write failing path, listing, and preview tests**

Create fixtures in `src-tauri/tests/project_files.rs` with literal expectations:

```rust
use claude_desk_lib::files::{list_directory, read_preview};

#[test]
fn lists_directories_first_and_returns_only_relative_paths() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join("src")).unwrap();
    std::fs::write(temp.path().join("z.txt"), "z").unwrap();
    std::fs::write(temp.path().join("A.md"), "# A").unwrap();
    let entries = list_directory(temp.path(), "").unwrap();
    assert_eq!(entries.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["src", "A.md", "z.txt"]);
}

#[test]
fn rejects_parent_absolute_and_outside_symlink_paths() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(read_preview(temp.path(), "../secret").unwrap_err().code, "path_outside_project");
    assert_eq!(read_preview(temp.path(), "/etc/hosts").unwrap_err().code, "path_outside_project");
}

#[test]
fn classifies_text_image_binary_and_large_files() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("readme.md"), "# Hello").unwrap();
    std::fs::write(temp.path().join("pixel.png"), [137, 80, 78, 71]).unwrap();
    std::fs::write(temp.path().join("raw.bin"), [0, 1, 2]).unwrap();
    std::fs::write(temp.path().join("large.txt"), vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
    assert_eq!(read_preview(temp.path(), "readme.md").unwrap().kind.as_str(), "text");
    assert_eq!(read_preview(temp.path(), "pixel.png").unwrap().kind.as_str(), "image");
    assert_eq!(read_preview(temp.path(), "raw.bin").unwrap().kind.as_str(), "binary");
    assert_eq!(read_preview(temp.path(), "large.txt").unwrap().kind.as_str(), "too_large");
}
```

On Unix add a `#[cfg(unix)]` test that creates a symlink to a sibling temp directory and expects `path_outside_project`.

- [ ] **Step 2: Run the Rust integration test and verify RED**

Run: `cd src-tauri && cargo test --test project_files`

Expected: FAIL because `claude_desk_lib::files` and the DTOs do not exist.

- [ ] **Step 3: Define serializable DTOs and secure path resolution**

Add camelCase DTOs in `src-tauri/src/domain.rs`. In `src-tauri/src/files/mod.rs`, define `MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024`, reject `Component::ParentDir`, `RootDir`, and `Prefix`, canonicalize the root and target, then require `target.starts_with(&root)`. List direct children, skip expansion of `.git`, sort directories first with lowercase names, and return forward-slash relative paths.

Implement MIME classification by extension for PNG/JPEG/GIF/WebP/BMP/SVG; return image bytes without interpreting SVG. For other files, reject NUL-containing or invalid UTF-8 content as binary. Check metadata before reading and byte count after reading.

- [ ] **Step 4: Export the module and run the test GREEN**

Add `pub mod files;` to `src-tauri/src/lib.rs`.

Run: `cd src-tauri && cargo test --test project_files`

Expected: all listing, traversal, symlink, and classification tests PASS.

- [ ] **Step 5: Commit the secure file boundary**

```bash
git add src-tauri/src/files/mod.rs src-tauri/src/domain.rs src-tauri/src/lib.rs src-tauri/tests/project_files.rs
git commit -m "feat(files): add secure project file reader"
```

---

### Task 2: Project File Search

**Files:**
- Modify: `src-tauri/src/files/mod.rs`
- Modify: `src-tauri/tests/project_files.rs`

**Interfaces:**
- Consumes: `search_files(root: &Path, query: &str, limit: usize)` with a validated project root.
- Produces: `Result<Vec<ProjectFileEntry>, AppError>` containing files only, capped to `limit.min(200)`, ranked by filename match before path match.

- [ ] **Step 1: Write failing Git and fallback search tests**

Add tests that initialize a Git fixture, commit `src/main.ts`, create untracked `docs/Guide.md`, ignore `node_modules`, and assert:

```rust
let found = search_files(root, "main", 200).unwrap();
assert_eq!(found.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["src/main.ts"]);
assert!(!search_files(root, "dependency", 200).unwrap().iter().any(|entry| entry.path.starts_with("node_modules/")));
```

Add a non-Git fixture with `src/main.rs`, `docs/main-notes.md`, and `node_modules/main.js`; assert the first two are returned, the ignored dependency is not, and a requested limit of `1` returns one entry.

- [ ] **Step 2: Run the search tests and verify RED**

Run: `cd src-tauri && cargo test --test project_files search`

Expected: FAIL because `search_files` is missing.

- [ ] **Step 3: Implement Git-backed and fallback search**

Use `git -C <root> ls-files --cached --others --exclude-standard -z` when it exits successfully. Otherwise recursively scan with `std::fs::read_dir`, skipping `.git`, `node_modules`, `target`, and `dist`. Normalize separators to `/`, match lowercase query against the full relative path, rank basename prefix/substring before path-only matches, sort deterministically, and truncate to `limit.clamp(1, 200)`.

The query may match directory segments, but results contain files only.

- [ ] **Step 4: Run all project file tests GREEN**

Run: `cd src-tauri && cargo test --test project_files`

Expected: all tests PASS.

- [ ] **Step 5: Commit search**

```bash
git add src-tauri/src/files/mod.rs src-tauri/tests/project_files.rs
git commit -m "feat(files): search project paths"
```

---

### Task 3: Tauri Commands and TypeScript IPC Contract

**Files:**
- Create: `src-tauri/src/commands/files.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/domain/models.ts`
- Modify: `src/services/ipc.ts`
- Test: `src-tauri/tests/project_files.rs`

**Interfaces:**
- Consumes: Task 1 and 2 functions plus `AppState.storage.get_project(project_id)`.
- Produces Tauri commands `list_project_directory(project_id, path)`, `search_project_files(project_id, query, limit)`, and `read_project_file(project_id, path)`.
- Produces TypeScript interfaces matching the Rust DTOs and IPC methods `ipc.listProjectDirectory`, `ipc.searchProjectFiles`, and `ipc.readProjectFile`.

- [ ] **Step 1: Add serialization contract tests**

Add a test serializing representative entry and preview DTOs and assert exact camelCase JSON fields and snake_case enum values, including `mimeType` and `too_large`.

- [ ] **Step 2: Run the serialization test RED**

Run: `cd src-tauri && cargo test --test project_files serialization`

Expected: FAIL until all serde annotations and enum values match.

- [ ] **Step 3: Add command wrappers and register them**

Each command validates the UUID with `validate_id`, loads the project, and passes `Path::new(&project.path)` to the file module. Register all three commands in `tauri::generate_handler!` and export `commands::files`.

Add exact TypeScript definitions:

```ts
export type ProjectFileKind = 'file' | 'directory'
export interface ProjectFileEntry { name: string; path: string; kind: ProjectFileKind; extension: string | null }
export type ProjectFilePreviewKind = 'text' | 'image' | 'binary' | 'too_large'
export interface ProjectFilePreview { path: string; kind: ProjectFilePreviewKind; mimeType: string | null; content: string | null; bytes: number[] | null; size: number }
```

Wire the three `invoke` calls with camelCase arguments in `src/services/ipc.ts`.

- [ ] **Step 4: Verify Rust and TypeScript contracts**

Run: `cd src-tauri && cargo test --test project_files && cd .. && pnpm typecheck`

Expected: both commands exit 0.

- [ ] **Step 5: Commit the IPC boundary**

```bash
git add src-tauri/src/commands/files.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/domain.rs src/domain/models.ts src/services/ipc.ts src-tauri/tests/project_files.rs
git commit -m "feat(files): expose project file commands"
```

---

### Task 4: Frontend File Data Service

**Files:**
- Create: `src/services/projectFiles.ts`
- Create: `src/services/projectFiles.spec.ts`

**Interfaces:**
- Consumes: the three Task 3 IPC methods.
- Produces `createProjectFilesClient(projectId)` with `listDirectory(path, force?)`, `search(query)`, `read(path, force?)`, and `clear()`; repeated directory/read requests share promises, while failed requests are evicted.
- Produces pure `sortProjectEntries(entries)` for deterministic directory-first ordering.

- [ ] **Step 1: Write failing cache, retry, sort, and stale-search tests**

Mock only `ipc`. Assert two concurrent `listDirectory('src')` calls return the same Promise and invoke IPC once; a rejected request is invoked again on retry; sorting returns `directory A`, `directory z`, `file A`, `file z`; and a slower old search response cannot replace the latest result when used through the client request token.

- [ ] **Step 2: Run the service test RED**

Run: `pnpm exec vitest run src/services/projectFiles.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the client**

Use `Map<string, Promise<ProjectFileEntry[]>>` for directories and `Map<string, Promise<ProjectFilePreview>>` for previews. Normalize query with `trim()`, return an empty list for an empty search without IPC, and increment `searchVersion` on every search/clear so callers can identify current results. Do not cache searches.

- [ ] **Step 4: Run the service test GREEN**

Run: `pnpm exec vitest run src/services/projectFiles.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the service**

```bash
git add src/services/projectFiles.ts src/services/projectFiles.spec.ts
git commit -m "feat(files): add project files client"
```

---

### Task 5: Lazy Project File Tree

**Files:**
- Create: `src/components/files/ProjectFileTree.vue`
- Create: `src/components/files/ProjectFileTree.spec.ts`

**Interfaces:**
- Consumes props `rootName`, `entries`, `childrenByPath`, `loadingPaths`, `errorPaths`, `query`, `activePath`, and `selectedPath`.
- Emits `expand(path)`, `retry(path)`, and `select(path)`; the parent owns all async operations.

- [ ] **Step 1: Write failing tree behavior tests**

Mount real tree nodes and assert directory-first display, indentation, chevron expansion events, file selection, selected-row styling, per-node retry, and keyboard behavior: ArrowDown/Up changes active row, ArrowRight expands a directory, ArrowLeft collapses or selects the parent, Enter opens a file.

- [ ] **Step 2: Run tree tests RED**

Run: `pnpm exec vitest run src/components/files/ProjectFileTree.spec.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement accessible recursive rows**

Render a `role="tree"` container and `role="treeitem"` rows with `aria-expanded` for directories. Use `Folder`, `FolderOpen`, `File`, and `ChevronRight` icons. Keep recursive rendering in the same component through a small internal row component only if Vue recursion becomes unclear; do not put fetching inside rows.

When `query` is non-empty, render `entries` as a flat result list with the basename emphasized and the remaining path muted.

- [ ] **Step 4: Run tree tests GREEN**

Run: `pnpm exec vitest run src/components/files/ProjectFileTree.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the tree**

```bash
git add src/components/files/ProjectFileTree.vue src/components/files/ProjectFileTree.spec.ts
git commit -m "feat(files): add searchable project tree"
```

---

### Task 6: Read-Only File Preview

**Files:**
- Create: `src/components/files/FilePreview.vue`
- Create: `src/components/files/FilePreview.spec.ts`
- Modify: `src/components/conversation/markdown.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes props `preview: ProjectFilePreview | null`, `loading`, and `error`.
- Emits `refresh`, `close`, and `copy(content)`.
- Reuses `renderMarkdown(source)` and uses `highlight.js/lib/core` with registered common languages; unknown extensions render escaped plaintext.

- [ ] **Step 1: Install syntax highlighting and write failing preview tests**

Run: `pnpm add highlight.js`

Test literal text preview lines, line numbers beginning at 1, highlighted TypeScript output, Markdown source/preview toggle, sanitized script removal, image Blob URL creation/revocation, binary metadata, too-large copy, loading/error states, and emitted copy content.

- [ ] **Step 2: Run preview tests RED**

Run: `pnpm exec vitest run src/components/files/FilePreview.spec.ts`

Expected: FAIL because `FilePreview.vue` is missing.

- [ ] **Step 3: Implement preview routing**

Use computed lines derived from `preview.content ?? ''`; generate highlighted HTML per line only after HTML escaping through highlight.js. Render Markdown with the existing sanitized renderer. For images, create a Blob from `preview.bytes`, call `URL.createObjectURL`, and revoke the previous URL in watcher cleanup and on unmount. SVG is displayed only through the Blob URL in `<img>`, never `v-html`.

Copy is disabled for image/binary/too-large previews. The component emits the text to the parent; the parent performs `navigator.clipboard.writeText` and owns error display.

- [ ] **Step 4: Run preview and Markdown regression tests GREEN**

Run: `pnpm exec vitest run src/components/files/FilePreview.spec.ts src/components/conversation/MessageBubble.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit preview support**

```bash
git add package.json pnpm-lock.yaml src/components/files/FilePreview.vue src/components/files/FilePreview.spec.ts src/components/conversation/markdown.ts
git commit -m "feat(files): preview project files"
```

---

### Task 7: Resizable Files Drawer

**Files:**
- Create: `src/components/files/FileBrowserDrawer.vue`
- Create: `src/components/files/FileBrowserDrawer.spec.ts`
- Modify: `src/services/i18n.ts`

**Interfaces:**
- Consumes props `projectId`, `projectName`, and `width`.
- Emits `close` and `resize(width)`.
- Owns one `createProjectFilesClient(projectId)` instance and composes `ProjectFileTree` plus `FilePreview`.
- Exposes `focusFilter()` for App-level repeated-shortcut behavior.

- [ ] **Step 1: Write failing drawer integration tests**

Mock only the project file service boundary. Assert initial root load, input focus, 120ms debounced search, stale result rejection, directory expansion caching, selection-to-preview flow, Markdown preview persistence per selected file, refresh bypassing cache, clear-then-close Escape behavior, copy through `navigator.clipboard.writeText`, and `resize` values clamped to 520–960.

Assert the DOM keeps `.file-preview-pane` and `.project-tree-pane` inside `.files-drawer`, with the tree alone before selection.

- [ ] **Step 2: Run drawer tests RED**

Run: `pnpm exec vitest run src/components/files/FileBrowserDrawer.spec.ts`

Expected: FAIL because the drawer does not exist.

- [ ] **Step 3: Implement drawer orchestration and styling**

Use a 120ms timer for search; increment a local query version before awaiting and discard results when the version or project ID no longer matches. Load root path `''` on mount. Store expanded paths and children maps locally. On project ID change, clear client state, selection, query, expanded paths, and preview before loading the new root.

Use a pointer-driven resize handle with `setPointerCapture`, emitting `clamp(startWidth + startX - currentX, 520, 960)`. Add Chinese and English translations for Files, filter placeholder, source/preview toggle, empty, binary, too large, retry, and copied states.

- [ ] **Step 4: Run drawer tests GREEN**

Run: `pnpm exec vitest run src/components/files/FileBrowserDrawer.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the drawer**

```bash
git add src/components/files/FileBrowserDrawer.vue src/components/files/FileBrowserDrawer.spec.ts src/services/i18n.ts
git commit -m "feat(files): add resizable files drawer"
```

---

### Task 8: Task Header Integration and Global Shortcut

**Files:**
- Create: `src/services/fileShortcut.ts`
- Create: `src/services/fileShortcut.spec.ts`
- Create: `src/App.spec.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `FileBrowserDrawer` and selected project/task state.
- Produces `isFilesShortcut(event: KeyboardEvent) -> boolean` and the user-visible `Files` button / drawer integration.

- [ ] **Step 1: Write failing shortcut and App integration tests**

For `isFilesShortcut`, assert lowercase/uppercase `p` with exactly one platform command modifier succeeds, while Alt, Shift, composing input, and unmodified `p` fail.

In `App.spec.ts`, mock IPC/event listeners and mount the real App with `ConversationView` and drawer stubs. Assert clicking `[data-testid="files-toggle"]` and dispatching `metaKey+p` opens the drawer; settings view blocks it; a second shortcut calls exposed `focusFilter`; Escape behavior stays in the drawer; switching to another task in the same project retains the drawer; switching projects changes drawer props; and `ConversationView` retains the same element instance before and after opening.

- [ ] **Step 2: Run shortcut and App tests RED**

Run: `pnpm exec vitest run src/services/fileShortcut.spec.ts src/App.spec.ts`

Expected: FAIL because the shortcut helper, button, and integration are absent.

- [ ] **Step 3: Integrate without replacing ConversationView**

Add `filesOpen`, `filesWidth`, and `filesDrawer` refs to `App.vue`. Register one window `keydown` listener on mount and remove it on unmount. Ignore shortcut handling when settings are open, when `event.isComposing`, or when another `[role="dialog"]` exists. Prevent the browser print action only for valid Files shortcuts.

Place the button after the model chip:

```vue
<button data-testid="files-toggle" class="files-toggle" type="button" :class="{ active: filesOpen }" @click="toggleFiles">
  <Files :size="15" /><span>{{ t('files') }}</span><kbd>⌘P</kbd>
</button>
```

Wrap only the content below `.task-header` in `.workspace-body`; keep `ConversationView` as the first persistent child and conditionally append `FileBrowserDrawer` as the second child. Use flex layout on wide screens and absolute overlay CSS below 960px.

- [ ] **Step 4: Run integration and existing conversation tests GREEN**

Run: `pnpm exec vitest run src/services/fileShortcut.spec.ts src/App.spec.ts src/components/conversation/ConversationView.spec.ts src/components/conversation/ComposerBox.spec.ts`

Expected: all tests PASS and the ConversationView identity assertion remains stable.

- [ ] **Step 5: Commit App integration**

```bash
git add src/App.vue src/App.spec.ts src/services/fileShortcut.ts src/services/fileShortcut.spec.ts
git commit -m "feat(files): integrate files drawer shortcut"
```

---

### Task 9: End-to-End Verification and Smoke Checklist

**Files:**
- Modify: `docs/testing/platform-smoke.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: repeatable automated and manual verification evidence.

- [ ] **Step 1: Add Files smoke cases**

Append checklist items covering mouse and shortcut opening, filtering a tracked file, lazy directory expansion, text/Markdown/image preview, copy, resize, narrow overlay, project switching, running-task continuity, binary/large file states, and an outside-project symlink rejection.

- [ ] **Step 2: Run format and static checks**

Run:

```bash
cd src-tauri && cargo fmt -- --check
cd .. && pnpm typecheck
git diff --check
```

Expected: all commands exit 0. If repository-wide Rust formatting has pre-existing failures, run `rustfmt --edition 2021 --check` on every Rust file changed by this plan and record the unrelated baseline separately.

- [ ] **Step 3: Run frontend and backend suites**

Run:

```bash
pnpm test
pnpm build
cd src-tauri && cargo test
```

Expected: all new tests pass; production build and all Rust tests exit 0. Preserve and report any independently reproducible pre-existing frontend failure rather than modifying unrelated code.

- [ ] **Step 4: Perform macOS manual smoke test**

Run `pnpm tauri:dev`, open a real project, and execute every Files item added to `docs/testing/platform-smoke.md`. Confirm a streaming Claude response continues while the drawer opens, filters, previews, resizes, and closes.

- [ ] **Step 5: Commit verification documentation**

```bash
git add docs/testing/platform-smoke.md
git commit -m "test(files): document files drawer smoke coverage"
```

