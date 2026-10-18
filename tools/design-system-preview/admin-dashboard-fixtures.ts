import { useSyncExternalStore } from "react";
import snapshot from "../../tests/admin-e2e/fixtures/dashboard-snapshot.json";
import type { OpsSnapshotData } from "../../app/ui/src/contexts/OpsSnapshotContext";
// Isolated fictional reports/actions; production Dashboard still reads its shared ops provider.
export type DashboardSample =
  | "ready"
  | "empty"
  | "interruption"
  | "stale"
  | "partial"
  | "loading"
  | "offline";
let sample: DashboardSample = "ready",
  outcome = "Sin acciones de muestra.",
  refreshCount = 0;
const listeners = new Set<() => void>();
function makeContext() {
  const data = structuredClone(snapshot) as unknown as OpsSnapshotData;
  const now = Date.now();
  data.snapshot.built_at = new Date(now - 15000).toISOString();
  data.snapshot.stale_after = new Date(now + 60000).toISOString();
  data.live.running_tasks[0]!.status = "running";
  data.live.running_tasks[0]!.progress = JSON.stringify({
    done: 3,
    total: 12,
    phase: "processing",
    item: "Costa Norte",
  });
  data.live.running_tasks[0]!.updated_at = new Date(now - 10000).toISOString();
  data.live.recent_tasks = [
    {
      id: "sample-completed",
      type: "sync_library",
      status: "completed",
      updated_at: new Date(now - 60000).toISOString(),
    },
    {
      id: "sample-failed",
      type: "compute_bliss",
      status: "failed",
      updated_at: new Date(now - 86400000).toISOString(),
    },
  ];
  if (sample === "empty") {
    data.live.running_tasks = [];
    data.live.recent_tasks = data.live.recent_tasks.filter(
      (task) => task.status === "completed",
    );
    for (const queue of Object.values(data.live.queue_breakdown))
      for (const key of Object.keys(queue)) Object.assign(queue, { [key]: 0 });
    data.analysis.analysis_active = 0;
    data.analysis.bliss_active = 0;
  }
  if (sample === "interruption") data.live.systems.postgres = false;
  if (sample === "stale") {
    data.snapshot.stale = true;
    data.snapshot.built_at = new Date(now - 600000).toISOString();
    data.snapshot.stale_after = new Date(now - 540000).toISOString();
    data.live.systems.postgres = false;
  }
  if (sample === "partial") delete (data as Partial<OpsSnapshotData>).live;
  return {
    data: sample === "loading" || sample === "offline" ? null : data,
    loading: sample === "loading",
    error: sample === "offline" ? "Sample dashboard unavailable" : null,
    refresh,
  };
}
let context = makeContext();
let state: { sample: DashboardSample; outcome: string; refreshCount: number } =
  { sample, outcome, refreshCount };
function emit() {
  state = { sample, outcome, refreshCount };
  listeners.forEach((listener) => listener());
}
export function subscribeDashboardSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function dashboardSampleState() {
  return state;
}
export function setDashboardSample(next: DashboardSample) {
  sample = next;
  outcome = "Sin acciones de muestra.";
  context = makeContext();
  emit();
}
export function useOpsSnapshot() {
  return useSyncExternalStore(subscribeDashboardSample, () => context);
}
async function refresh() {
  refreshCount += 1;
  if (["offline", "loading", "stale"].includes(sample)) sample = "ready";
  context = makeContext();
  emit();
}
const paths = new Set([
  "/api/tasks/sync-library",
  "/api/manage/rebuild",
  "/api/manage/wipe",
]);
export async function api(path: string, method: string, body?: unknown) {
  if (method !== "POST" || !paths.has(path))
    throw new Error("Unexpected sample action");
  outcome = `${method} ${path}${body ? ` · ${JSON.stringify(body)}` : ""} · muestra local`;
  emit();
  return { task_id: "sample-dashboard" };
}
