import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, appLocalDataDir } from "@tauri-apps/api/path";
import {
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const resultsElement = document.querySelector("#results");
const reportPort = new URLSearchParams(location.search).get("port") ?? "18766";
const reportUrl = `http://127.0.0.1:${reportPort}/report`;
const dataDirectory = BaseDirectory.AppLocalData;
const stats = {
  commands: new Map(),
  activeVerifyCommands: 0,
  maxActiveVerifyCommands: 0,
  indexWriteCalls: 0,
  indexWriteBytes: 0,
  indexWriteDurationsMs: [],
};

function resetStats() {
  stats.commands.clear();
  stats.activeVerifyCommands = 0;
  stats.maxActiveVerifyCommands = 0;
  stats.indexWriteCalls = 0;
  stats.indexWriteBytes = 0;
  stats.indexWriteDurationsMs = [];
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? sorted.at(-1);
}

function summarizeTimes(values) {
  return {
    minMs: percentile(values, 0),
    medianMs: percentile(values, 0.5),
    maxMs: percentile(values, 1),
  };
}

function snapshotStats() {
  return {
    commands: Object.fromEntries(stats.commands),
    maxActiveVerifyCommands: stats.maxActiveVerifyCommands,
    indexWriteCalls: stats.indexWriteCalls,
    indexWriteBytes: stats.indexWriteBytes,
    indexWriteP95Ms: percentile(stats.indexWriteDurationsMs, 0.95),
  };
}

function installInvokeProbe() {
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    throw new Error("Tauri invoke bridge is unavailable");
  }
  window.__crateTauriInvoke = async (command, args) => {
    stats.commands.set(command, (stats.commands.get(command) ?? 0) + 1);
    const isVerify = command === "verify_offline_media_assets";
    if (isVerify) {
      stats.activeVerifyCommands += 1;
      stats.maxActiveVerifyCommands = Math.max(
        stats.maxActiveVerifyCommands,
        stats.activeVerifyCommands,
      );
    }
    try {
      return await invoke(command, args);
    } finally {
      if (isVerify) stats.activeVerifyCommands -= 1;
    }
  };
  window.__crateNativePerfObserver = (event) => {
    if (
      event?.operation !== "write" ||
      !event.path?.includes("offline-assets-")
    ) {
      return;
    }
    stats.indexWriteCalls += 1;
    stats.indexWriteBytes += event.byteLength ?? 0;
    stats.indexWriteDurationsMs.push(event.elapsedMs ?? 0);
  };
  return () => {
    delete window.__crateNativePerfObserver;
    delete window.__crateTauriInvoke;
  };
}

async function ensureDirectory(path) {
  await mkdir(path, { baseDir: dataDirectory, recursive: true });
}

function makeAssetRecords(profileKey, count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const assetKey = `asset-${index}`;
      const filename = `asset-${String(index).padStart(5, "0")}.flac`;
      return [
        assetKey,
        {
          assetKey,
          path: `offline-media/${profileKey}/${filename}`,
          state: "ready",
          deliveryByteLength: 1,
        },
      ];
    }),
  );
}

async function measureHydration(storage) {
  const measurements = [];
  for (const count of [100, 1_000, 5_000]) {
    const samples = [];
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const profileKey = `r03-${repetition}-${count}`;
      await ensureDirectory(`offline-media/${profileKey}`);
      await ensureDirectory("offline-meta");
      const index = makeAssetRecords(profileKey, count);
      await writeTextFile(
        `offline-meta/offline-assets-${profileKey}.json`,
        JSON.stringify(index),
        { baseDir: dataDirectory },
      );

      resetStats();
      let started = performance.now();
      await storage.hydrateOfflineProfileState(profileKey);
      const firstPassMs = performance.now() - started;
      const hydratedEntries = Object.keys(
        storage.loadOfflineNativeAssetIndex(profileKey),
      ).length;
      const firstPassStats = snapshotStats();

      resetStats();
      started = performance.now();
      await storage.hydrateOfflineProfileState(profileKey);
      const warmPassMs = performance.now() - started;
      samples.push({
        firstPassMs,
        warmPassMs,
        hydratedEntries,
        firstPassStats,
        warmPassStats: snapshotStats(),
      });
    }
    measurements.push({
      assets: count,
      firstPass: summarizeTimes(samples.map((sample) => sample.firstPassMs)),
      warmPass: summarizeTimes(samples.map((sample) => sample.warmPassMs)),
      samples,
    });
  }
  return measurements;
}

async function seedVerificationFiles(count) {
  const profileKey = "verify-files";
  await ensureDirectory(`offline-media/${profileKey}`);
  const started = performance.now();
  const batchSize = 64;
  for (let offset = 0; offset < count; offset += batchSize) {
    const end = Math.min(count, offset + batchSize);
    await Promise.all(
      Array.from({ length: end - offset }, (_, batchIndex) => {
        const index = offset + batchIndex;
        const filename = `asset-${String(index).padStart(5, "0")}.flac`;
        return writeTextFile(`offline-media/${profileKey}/${filename}`, "x", {
          baseDir: dataDirectory,
        });
      }),
    );
  }
  return { profileKey, seedMs: performance.now() - started };
}

function makeExpectations(profileKey, start, count) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    const filename = `asset-${String(index).padStart(5, "0")}.flac`;
    return {
      path: `offline-media/${profileKey}/${filename}`,
      expectedBytes: 1,
    };
  });
}

async function measureVerification(verifyNativeOfflineAssets, profileKey) {
  const measurements = [];
  for (const count of [100, 1_000, 5_000]) {
    const assets = makeExpectations(profileKey, 0, count);
    const samples = [];
    for (let repetition = 0; repetition < 3; repetition += 1) {
      resetStats();
      const started = performance.now();
      const verified = await verifyNativeOfflineAssets(assets);
      samples.push({
        elapsedMs: performance.now() - started,
        validAssets: verified.filter((item) => item.valid).length,
        stats: snapshotStats(),
      });
    }
    measurements.push({
      assets: count,
      expectedIpcBatches: Math.ceil(count / 500),
      elapsed: summarizeTimes(samples.map((sample) => sample.elapsedMs)),
      validAssets: samples.map((sample) => sample.validAssets),
      samples,
    });
  }

  const setA = makeExpectations(profileKey, 0, 1_000);
  const setB = makeExpectations(profileKey, 1_000, 1_000);
  const callerSamples = [];
  for (let repetition = 0; repetition < 3; repetition += 1) {
    resetStats();
    let started = performance.now();
    await verifyNativeOfflineAssets(setA);
    await verifyNativeOfflineAssets(setB);
    const sequentialMs = performance.now() - started;
    const sequentialStats = snapshotStats();

    resetStats();
    started = performance.now();
    const [concurrentA, concurrentB] = await Promise.all([
      verifyNativeOfflineAssets(setA),
      verifyNativeOfflineAssets(setB),
    ]);
    const concurrentMs = performance.now() - started;
    callerSamples.push({
      sequentialMs,
      sequentialStats,
      concurrentMs,
      validConcurrent:
        concurrentA.filter((item) => item.valid).length +
        concurrentB.filter((item) => item.valid).length,
      concurrentStats: snapshotStats(),
    });
  }
  return {
    seedMs: null,
    batches: measurements,
    twoCallers: {
      assetsPerCaller: 1_000,
      sequential: summarizeTimes(
        callerSamples.map((sample) => sample.sequentialMs),
      ),
      concurrent: summarizeTimes(
        callerSamples.map((sample) => sample.concurrentMs),
      ),
      samples: callerSamples,
    },
  };
}

function makeIndexRecord(profileKey, index) {
  const key = `asset-${index}`;
  return {
    assetKey: key,
    path: `offline-media/${profileKey}/${key}.flac`,
    state: "ready",
    deliveryByteLength: 1,
  };
}

async function measureIndexWrites(storage) {
  const serialCount = 100;
  const serialSamples = [];
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const serialProfile = `r05-serial-${repetition}`;
    let serialIndex = {};
    resetStats();
    const started = performance.now();
    for (let index = 0; index < serialCount; index += 1) {
      serialIndex = {
        ...serialIndex,
        [`asset-${index}`]: makeIndexRecord(serialProfile, index),
      };
      await storage.saveOfflineNativeAssetIndex(serialProfile, serialIndex);
    }
    serialSamples.push({
      elapsedMs: performance.now() - started,
      durableEntries: Object.keys(serialIndex).length,
      stats: snapshotStats(),
    });
  }

  const batched = [];
  for (const count of [100, 1_000, 5_000]) {
    const samples = [];
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const profileKey = `r05-batch-${count}-${repetition}`;
      resetStats();
      const started = performance.now();
      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          storage.updateOfflineNativeAssetIndex(profileKey, (current) => ({
            ...current,
            [`asset-${index}`]: makeIndexRecord(profileKey, index),
          })),
        ),
      );
      const elapsedMs = performance.now() - started;
      const measuredStats = snapshotStats();
      const serialized = await readTextFile(
        `offline-meta/offline-assets-${profileKey}.json`,
        { baseDir: dataDirectory },
      );
      const durableEntries = Object.keys(JSON.parse(serialized)).length;
      samples.push({
        elapsedMs,
        durableEntries,
        finalIndexBytes: new TextEncoder().encode(serialized).byteLength,
        stats: measuredStats,
      });
    }
    batched.push({
      mutations: count,
      elapsed: summarizeTimes(samples.map((sample) => sample.elapsedMs)),
      samples,
    });
  }
  return {
    serialControl: {
      mutations: serialCount,
      elapsed: summarizeTimes(serialSamples.map((sample) => sample.elapsedMs)),
      samples: serialSamples,
    },
    batched,
  };
}

async function measurePairwiseIndexWrites(storage) {
  const mutations = 1_000;
  const samples = [];
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const profileKey = `r05-pairwise-${repetition}`;
    const commitLatenciesMs = [];
    resetStats();
    const started = performance.now();
    for (let offset = 0; offset < mutations; offset += 2) {
      const commitStarted = performance.now();
      await Promise.all([
        storage.updateOfflineNativeAssetIndex(profileKey, (current) => ({
          ...current,
          [`asset-${offset}`]: makeIndexRecord(profileKey, offset),
        })),
        storage.updateOfflineNativeAssetIndex(profileKey, (current) => ({
          ...current,
          [`asset-${offset + 1}`]: makeIndexRecord(profileKey, offset + 1),
        })),
      ]);
      commitLatenciesMs.push(performance.now() - commitStarted);
    }
    const elapsedMs = performance.now() - started;
    const measuredStats = snapshotStats();
    const serialized = await readTextFile(
      `offline-meta/offline-assets-${profileKey}.json`,
      { baseDir: dataDirectory },
    );
    samples.push({
      elapsedMs,
      commitLatency: {
        p50Ms: percentile(commitLatenciesMs, 0.5),
        p95Ms: percentile(commitLatenciesMs, 0.95),
        maxMs: percentile(commitLatenciesMs, 1),
      },
      durableEntries: Object.keys(JSON.parse(serialized)).length,
      finalIndexBytes: new TextEncoder().encode(serialized).byteLength,
      stats: measuredStats,
    });
  }
  return {
    mutations,
    completionConcurrency: 2,
    commitsPerRun: mutations / 2,
    elapsed: summarizeTimes(samples.map((sample) => sample.elapsedMs)),
    samples,
  };
}

async function postReport(report) {
  const response = await fetch(reportUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!response.ok)
    throw new Error(`Report server returned HTTP ${response.status}`);
}

async function cleanup() {
  await remove("offline-media", {
    baseDir: dataDirectory,
    recursive: true,
  }).catch(() => undefined);
  await remove("offline-meta", {
    baseDir: dataDirectory,
    recursive: true,
  }).catch(() => undefined);
}

async function run() {
  const restoreInvoke = installInvokeProbe();
  const report = {
    event: "native-performance-results",
    revision: new URLSearchParams(location.search).get("revision"),
    host: navigator.userAgent,
    startedAt: new Date().toISOString(),
  };
  try {
    await appLocalDataDir();
    const storage = await import("../../../listen/src/lib/offline-storage.ts");
    const offlineNative = await import(
      "../../../listen/src/lib/offline-native.ts"
    );
    report.hydration = await measureHydration(storage);
    const seeded = await seedVerificationFiles(5_000);
    report.verification = await measureVerification(
      offlineNative.verifyNativeOfflineAssets,
      seeded.profileKey,
    );
    report.verification.seedMs = seeded.seedMs;
    report.indexWrites = await measureIndexWrites(storage);
    report.pairwiseIndexWrites = await measurePairwiseIndexWrites(storage);
    report.finishedAt = new Date().toISOString();
    await postReport(report);
    resultsElement.textContent = JSON.stringify(report, null, 2);
    document.title = "Tauri native performance probe: complete";
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.finishedAt = new Date().toISOString();
    await postReport(report).catch(() => undefined);
    resultsElement.textContent = JSON.stringify(report, null, 2);
    document.title = "Tauri native performance probe: failed";
  } finally {
    await cleanup();
    restoreInvoke();
  }
}

void run();
