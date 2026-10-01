import assert from "node:assert/strict";
import test from "node:test";

import { installNativePerfTelemetry } from "./telemetry.js";

function makeStats() {
  return {
    indexWriteCalls: 0,
    indexWriteBytes: 0,
    indexWriteDurationsMs: [],
  };
}

test("records successful offline index .next writes at the Tauri IPC boundary", async () => {
  const forwarded = [];
  const internals = {
    async invoke(...args) {
      forwarded.push(args);
      return "written";
    },
  };
  const originalInvoke = internals.invoke;
  const stats = makeStats();
  let clock = 20;
  const restore = installNativePerfTelemetry(stats, internals, () => clock++);

  const payload = new TextEncoder().encode('{"asset":"r05"}');
  const result = await internals.invoke("plugin:fs|write_text_file", payload, {
    headers: {
      path: "offline-meta%5Coffline-assets-r05.next",
    },
  });

  assert.equal(result, "written");
  assert.equal(forwarded.length, 1);
  assert.equal(stats.indexWriteCalls, 1);
  assert.equal(stats.indexWriteBytes, payload.byteLength);
  assert.deepEqual(stats.indexWriteDurationsMs, [1]);

  restore();
  assert.equal(internals.invoke, originalInvoke);
});

test("ignores unrelated filesystem writes and other Tauri commands", async () => {
  const stats = makeStats();
  const internals = { invoke: async () => undefined };
  const restore = installNativePerfTelemetry(stats, internals, () => 1);

  await internals.invoke("plugin:fs|write_text_file", new Uint8Array([1]), {
    headers: { path: "offline-meta%5Coffline-index-profile.next" },
  });
  await internals.invoke("verify_offline_media_assets", [], {});

  assert.equal(stats.indexWriteCalls, 0);
  assert.equal(stats.indexWriteBytes, 0);
  assert.deepEqual(stats.indexWriteDurationsMs, []);
  restore();
});

test("does not count failed durable writes", async () => {
  const stats = makeStats();
  const internals = {
    invoke: async () => {
      throw new Error("disk full");
    },
  };
  const restore = installNativePerfTelemetry(stats, internals, () => 1);

  await assert.rejects(
    internals.invoke("plugin:fs|write_text_file", new Uint8Array([1]), {
      headers: { path: "offline-meta%5Coffline-assets-profile.next" },
    }),
    /disk full/,
  );

  assert.equal(stats.indexWriteCalls, 0);
  assert.equal(stats.indexWriteBytes, 0);
  assert.deepEqual(stats.indexWriteDurationsMs, []);
  restore();
});
