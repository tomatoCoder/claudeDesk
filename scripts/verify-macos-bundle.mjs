import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { verifySidecar } from "./build-sidecar.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const app = join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", "Claude Desk.app");
const sidecar = join(app, "Contents", "MacOS", "claude-agent-bridge");
const signature = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (signature.status !== 0) {
  throw new Error(`Bundle signature verification failed: ${signature.stderr}`);
}

verifySidecar(sidecar);
process.stdout.write(`Verified signed app and Agent Bridge: ${app}\n`);
