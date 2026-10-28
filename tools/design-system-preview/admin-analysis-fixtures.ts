import { useSyncExternalStore } from "react";
import analysis from "../../tests/admin-e2e/fixtures/analysis-status.json";
// Only the isolated Analysis preview entry uses this local snapshot/action adapter.
export type AnalysisSample =
  "ready" | "loading" | "empty" | "fallback" | "missing" | "offline";
let sample: AnalysisSample = "ready";
let generation = 0;
let outcome = "Sin acciones de muestra.";
const listeners = new Set<() => void>();
const pending: (() => void)[] = [];
function makeContext() {
  const contextGeneration = generation;
  const status = structuredClone(analysis);
  if (sample === "empty") {
    for (const key of Object.keys(status) as (keyof typeof status)[]) {
      if (typeof status[key] === "number") Object.assign(status, { [key]: 0 });
    }
    Object.assign(status, {
      last_analyzed: {},
      last_bliss: {},
      last_fingerprinted: {},
    });
  }
  if (sample === "fallback") {
    status.chromaprint_available = false;
    status.last_fingerprinted.source = "pcm16-md5-v1";
  }
  return {
    data: ["loading", "missing", "offline"].includes(sample)
      ? null
      : { analysis: status },
    loading: sample === "loading",
    error: sample === "offline" ? "Sample analysis unavailable" : null,
    refresh: (fresh?: boolean) => refresh(fresh, contextGeneration),
  };
}
let context = makeContext();
let state: { sample: AnalysisSample; outcome: string } = { sample, outcome };
function emit() {
  state = { sample, outcome };
  listeners.forEach((listener) => listener());
}
export function subscribeAnalysisSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function analysisSampleState() {
  return state;
}
export function setAnalysisSample(next: AnalysisSample) {
  generation += 1;
  pending.length = 0;
  sample = next;
  context = makeContext();
  outcome = "Sin acciones de muestra.";
  emit();
}
export function useOpsSnapshot() {
  return useSyncExternalStore(subscribeAnalysisSample, () => context);
}
async function refresh(fresh: boolean | undefined, contextGeneration: number) {
  if (contextGeneration !== generation) return;
  if (["loading", "missing", "offline"].includes(sample)) sample = "ready";
  outcome = `Snapshot de muestra actualizado${fresh ? " · fresh" : ""}.`;
  context = makeContext();
  emit();
}
const actionPaths = new Set([
  "/api/tasks/backfill-track-fingerprints",
  "/api/manage/compute-popularity",
  "/api/manage/compute-bliss",
  "/api/manage/analyze-all",
  "/api/manage/sync-lyrics",
  "/api/manage/portable-metadata",
  "/api/manage/portable-metadata/rehydrate",
  "/api/manage/portable-metadata/export-rich",
]);
export async function api(path: string, method: string, body?: unknown) {
  if (method !== "POST" || !actionPaths.has(path))
    throw new Error("Unexpected sample action");
  outcome = `${method} ${path}${body ? ` · ${JSON.stringify(body)}` : ""} · muestra local`;
  emit();
  return new Promise((resolve) =>
    pending.push(() => resolve({ task_id: "sample-analysis" })),
  );
}
export function completeAnalysisActions() {
  pending.splice(0).forEach((complete) => complete());
}
