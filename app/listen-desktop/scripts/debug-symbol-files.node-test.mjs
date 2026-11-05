import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { debugSymbolFiles } from "./debug-symbol-files.mjs";

function targetDir(files) {
  const target = mkdtempSync(path.join(tmpdir(), "crate-desktop-target-"));
  for (const file of files) {
    const full = path.join(target, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "binary");
  }
  return target;
}

function relative(target, files) {
  return files.map((file) =>
    path.relative(target, file).split(path.sep).join("/"),
  );
}

test("selects the Windows app executable and its PDB", () => {
  const target = targetDir([
    "release/crate-desktop.exe",
    "release/crate_desktop.pdb",
    "release/crate_desktop_lib.dll",
    "release/http_pool_bench.exe",
    "release/deps/crate_desktop-95d23ac52410c10f.exe",
    "release/deps/crate_desktop-95d23ac52410c10f.pdb",
    "release/build/tauri-123/build_script_build.pdb",
  ]);

  assert.deepEqual(relative(target, debugSymbolFiles(target)), [
    "release/crate-desktop.exe",
    "release/crate_desktop.pdb",
  ]);
});

test("selects the macOS binary and its dSYM, also under a target triple", () => {
  const target = targetDir([
    "release/crate-desktop",
    "release/crate-desktop.dSYM/Contents/Resources/DWARF/crate-desktop",
    "aarch64-apple-darwin/release/crate-desktop",
    "aarch64-apple-darwin/release/crate-desktop.dSYM/Contents/Info.plist",
    "aarch64-apple-darwin/release/deps/crate_desktop-abc",
  ]);

  assert.deepEqual(relative(target, debugSymbolFiles(target)), [
    "aarch64-apple-darwin/release/crate-desktop",
    "aarch64-apple-darwin/release/crate-desktop.dSYM",
    "release/crate-desktop",
    "release/crate-desktop.dSYM",
  ]);
});

test("ignores debug builds and dependency folders", () => {
  const target = targetDir([
    "debug/crate-desktop",
    "release/deps/crate-desktop",
    "release/crate-desktop",
  ]);

  assert.deepEqual(relative(target, debugSymbolFiles(target)), [
    "release/crate-desktop",
  ]);
});

test("fails when no release build of the app exists", () => {
  const target = targetDir(["debug/crate-desktop", "release/deps/libfoo.rlib"]);

  assert.throws(
    () => debugSymbolFiles(target),
    /No release build of crate-desktop/,
  );
});
