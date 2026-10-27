import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { addStableNames, stableName } from "./stable-artifact-names.mjs";

test("drops the version from release asset names", () => {
  assert.equal(
    stableName("Crate-macos-arm64-2.7.4.app.zip", "2.7.4"),
    "Crate-macos-arm64.app.zip",
  );
  assert.equal(
    stableName("crate-windows-2.7.4.exe", "2.7.4"),
    "crate-windows.exe",
  );
  assert.equal(
    stableName("crate-linux-2.7.4.AppImage", "2.7.4"),
    "crate-linux.AppImage",
  );
});

test("ignores files from another version", () => {
  assert.equal(stableName("crate-linux-2.7.3.deb", "2.7.4"), null);
  assert.equal(stableName("crate-linux-12.7.4.deb", "2.7.4"), null);
});

test("copies each versioned artifact to its stable name", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "crate-artifacts-"));
  writeFileSync(path.join(directory, "crate-linux-2.7.4.deb"), "deb");
  writeFileSync(path.join(directory, "crate-linux-2.7.4.rpm"), "rpm");

  assert.deepEqual(addStableNames(directory, "2.7.4"), [
    "crate-linux.deb",
    "crate-linux.rpm",
  ]);
  assert.equal(
    readFileSync(path.join(directory, "crate-linux.deb"), "utf8"),
    "deb",
  );
  assert.equal(readdirSync(directory).length, 4);
});

test("fails when nothing matches the release version", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "crate-artifacts-"));
  writeFileSync(path.join(directory, "crate-linux-2.7.3.deb"), "deb");

  assert.throws(() => addStableNames(directory, "2.7.4"), /No artifacts/);
});
