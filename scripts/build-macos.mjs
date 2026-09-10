import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["tauri", "build", "--bundles", "app,dmg", "--ci"], { CI: "true" });
run(process.execPath, ["scripts/verify-macos-bundle.mjs"]);
