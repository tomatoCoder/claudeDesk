import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function sidecarTarget(triple) {
  const targets = {
    "aarch64-apple-darwin": {
      bunTarget: "bun-darwin-arm64",
      filename: "claude-agent-bridge-aarch64-apple-darwin",
    },
    "x86_64-pc-windows-msvc": {
      bunTarget: "bun-windows-x64",
      filename: "claude-agent-bridge-x86_64-pc-windows-msvc.exe",
    },
  };
  const target = targets[triple];
  if (!target) {
    throw new Error(`Unsupported sidecar target: ${triple}`);
  }
  return target;
}

function detectRustTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) {
    return process.env.TAURI_ENV_TARGET_TRIPLE;
  }
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Unable to detect Rust target: ${result.stderr || result.error}`);
  }
  const host = result.stdout.match(/^host:\s+(.+)$/m)?.[1];
  if (!host) {
    throw new Error("Unable to find the host triple in rustc -vV output");
  }
  return host;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${result.status}: ${result.stderr || result.error || ""}`,
    );
  }
  return result;
}

export function buildSidecar(triple = detectRustTriple()) {
  const { bunTarget, filename } = sidecarTarget(triple);
  const output = join(projectRoot, "src-tauri", "binaries", filename);
  // 使用 npm 包安装后的真实二进制；Windows 下直接 spawn `.cmd` 并不可靠。
  const bun = join(projectRoot, "node_modules", "bun", "bin", "bun.exe");

  mkdirSync(dirname(output), { recursive: true });
  run(bun, [
    "build",
    "bridge/src/main.ts",
    "--compile",
    `--target=${bunTarget}`,
    "--minify",
    `--outfile=${output}`,
  ]);

  if (!output.endsWith(".exe")) {
    chmodSync(output, 0o755);
  }

  verifySidecar(output);

  process.stdout.write(`Built and verified ${output}\n`);
  return output;
}

export function verifySidecar(executable) {
  const handshake = run(executable, [], {
    capture: true,
    input: `${JSON.stringify({
      v: 1,
      type: "handshake",
      requestId: "package-check",
      claudePath: process.execPath,
    })}\n`,
    timeout: 10_000,
  });
  const lines = handshake.stdout.trim().split("\n").filter(Boolean);
  const response = lines.map((line) => JSON.parse(line)).find((item) => item.type === "handshake.result");
  if (!response || response.v !== 1) {
    throw new Error(`Sidecar handshake failed: ${handshake.stdout}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildSidecar(process.argv[2]);
}
