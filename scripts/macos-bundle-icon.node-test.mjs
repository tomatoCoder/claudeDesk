import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const app = join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", "Claude Desk.app");
const plist = join(app, "Contents", "Info.plist");
const sourceIcon = join(projectRoot, "src-tauri", "icons", "icon.icns");

test("macOS bundle declares and embeds the generated app icon", () => {
  const iconLookup = spawnSync("plutil", ["-extract", "CFBundleIconFile", "raw", plist], {
    encoding: "utf8",
  });

  assert.equal(
    iconLookup.status,
    0,
    `packaged Info.plist must declare CFBundleIconFile: ${iconLookup.stderr.trim()}`,
  );

  const iconName = iconLookup.stdout.trim().endsWith(".icns")
    ? iconLookup.stdout.trim()
    : `${iconLookup.stdout.trim()}.icns`;
  const bundledIcon = join(app, "Contents", "Resources", iconName);

  assert.equal(existsSync(bundledIcon), true, `packaged icon is missing: ${bundledIcon}`);
  assert.deepEqual(readFileSync(bundledIcon), readFileSync(sourceIcon));
});
