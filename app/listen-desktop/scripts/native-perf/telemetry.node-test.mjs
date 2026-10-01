import assert from "node:assert/strict";
import test from "node:test";

import {
  installNativePerfTelemetry,
  writeTextFileWithTelemetry,
} from "./telemetry.js";

function makeStats() {
  return {
    indexWriteCalls: 0,
    indexWriteBytes: 0,
    indexWriteDurationsMs: [],
  };
}

test("records successful offline index .next writes", async () => {
  const forwarded = [];
  const target = {};
  const writeTextFile = async (...args) => {
    forwarded.push(args);
    return "written";
  };
  const stats = makeStats();
  let clock = 20;
  const restore = installNativePerfTelemetry(stats, target);

  const payload = '{"asset":"r05"}';
  const result = await writeTextFileWithTelemetry(
    writeTextFile,
    "offline-meta/offline-assets-r05.next",
    payload,
    { baseDir: "AppLocalData" },
    target,
    () => clock++,
  );

  assert.equal(result, "written");
  assert.equal(forwarded.length, 1);
  assert.equal(stats.indexWriteCalls, 1);
  assert.equal(
    stats.indexWriteBytes,
    new TextEncoder().encode(payload).byteLength,
  );
  assert.deepEqual(stats.indexWriteDurationsMs, [1]);

  restore();
  assert.equal(target.__crateNativePerfRecordWrite, undefined);
});

test("ignores unrelated filesystem writes", async () => {
  const stats = makeStats();
  const target = {};
  const restore = installNativePerfTelemetry(stats, target);

  await writeTextFileWithTelemetry(
    async () => undefined,
    "offline-meta/offline-index-profile.next",
    "{}",
    {},
    target,
    () => 1,
  );

  assert.equal(stats.indexWriteCalls, 0);
  assert.equal(stats.indexWriteBytes, 0);
  assert.deepEqual(stats.indexWriteDurationsMs, []);
  restore();
});

test("does not count failed durable writes", async () => {
  const stats = makeStats();
  const target = {};
  const restore = installNativePerfTelemetry(stats, target);
  const writeTextFile = async () => {
    throw new Error("disk full");
  };

  await assert.rejects(
    writeTextFileWithTelemetry(
      writeTextFile,
      "offline-meta/offline-assets-profile.next",
      "{}",
      {},
      target,
      () => 1,
    ),
    /disk full/,
  );

  assert.equal(stats.indexWriteCalls, 0);
  assert.equal(stats.indexWriteBytes, 0);
  assert.deepEqual(stats.indexWriteDurationsMs, []);
  restore();
});
