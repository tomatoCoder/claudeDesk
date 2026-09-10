import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const bridgePath = join(process.cwd(), "bridge", "dist", "main.js");

test("catalog requests exit even when the parent keeps stdin open", async () => {
  assert.equal(existsSync(bridgePath), true, "build the bridge before running this integration test");

  const child = spawn(process.execPath, [bridgePath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.stdin.write(`${JSON.stringify({
    v: 1,
    type: "catalog.list",
    requestId: "catalog-exit-test",
    claudePath: process.execPath,
    cwd: process.cwd(),
  })}\n`);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bridge remained alive after catalog response\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 3000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  assert.deepEqual(result, { code: 0, signal: null });
  const event = JSON.parse(stdout.trim());
  assert.equal(event.type, "catalog.result");
  assert.equal(event.requestId, "catalog-exit-test");
});
