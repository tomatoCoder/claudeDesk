import assert from "node:assert/strict";
import test from "node:test";

import { sidecarTarget } from "./build-sidecar.mjs";

test("maps supported Rust triples to Tauri sidecar filenames", () => {
  assert.deepEqual(sidecarTarget("aarch64-apple-darwin"), {
    bunTarget: "bun-darwin-arm64",
    filename: "claude-agent-bridge-aarch64-apple-darwin",
  });
  assert.deepEqual(sidecarTarget("x86_64-pc-windows-msvc"), {
    bunTarget: "bun-windows-x64",
    filename: "claude-agent-bridge-x86_64-pc-windows-msvc.exe",
  });
});

test("rejects targets outside the MVP support matrix", () => {
  assert.throws(
    () => sidecarTarget("x86_64-unknown-linux-gnu"),
    /Unsupported sidecar target/,
  );
});
