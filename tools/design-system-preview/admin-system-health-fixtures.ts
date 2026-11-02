import { useEffect, useSyncExternalStore } from "react";
import fixture from "../../tests/admin-e2e/fixtures/system-health-1ac.json";
export { taskLabel } from "../../app/ui/src/lib/task-catalog";

export type SystemSample =
  | "ready"
  | "pressure"
  | "unavailable"
  | "empty"
  | "partial"
  | "stale"
  | "legacy";
const listeners = new Set<() => void>();
function makeData(sample: SystemSample) {
  const data = structuredClone(fixture);
  const observed = new Date(
    sample === "stale" ? Date.now() - 600_000 : Date.now(),
  ).toISOString();
  data.summary._meta.generated_at = observed;
  data.summary._meta.collector_local.observed_at = observed;
  const points = Object.values(data.timeseries).flat();
  const latestBucket = Math.max(
    ...points.map((point) => Date.parse(point.timestamp)),
  );
  const storedAt = Math.floor(Date.parse(observed) / 60_000) * 60_000 - 300_000;
  for (const point of points)
    point.timestamp = new Date(
      Date.parse(point.timestamp) + storedAt - latestBucket,
    ).toISOString();
  for (const status of Object.values(data.timeseries_status)) {
    status.observed_at = new Date(storedAt).toISOString();
    status.age_seconds = (Date.now() - storedAt) / 1000;
    if (sample === "empty") {
      Object.assign(status, {
        availability: "empty",
        reason: "no_observations",
        observed_at: null,
        age_seconds: null,
      });
    }
  }
  if (sample === "empty")
    for (const name of Object.keys(data.timeseries))
      Reflect.set(data.timeseries, name, []);
  if (sample === "legacy") Reflect.deleteProperty(data, "timeseries_status");
  for (const metric of Object.values(data.summary)) {
    if (!("count" in metric)) continue;
    metric.observed_at = observed;
    metric.age_seconds = sample === "stale" ? 600 : 0;
    if (sample === "stale") metric.availability = "stale";
    if (sample === "unavailable" || sample === "empty") {
      Object.assign(metric, {
        availability: sample,
        count: 0,
        sum: 0,
        avg: 0,
        min: 0,
        max: 0,
        sample_count: 0,
        eligible_count: 0,
      });
    }
    if (sample === "legacy") {
      for (const field of [
        "availability",
        "source",
        "observed_at",
        "sample_count",
        "eligible_count",
      ])
        Reflect.deleteProperty(metric, field);
    }
  }
  if (sample === "partial") {
    data.summary._meta.collector_local.availability = "partial";
    data.summary._meta.collector_local.counters.buffer_full = 3;
  }
  if (sample === "unavailable")
    data.summary._meta.collector_local.availability = "unavailable";
  if (sample === "legacy") Reflect.deleteProperty(data.summary, "_meta");
  if (sample === "pressure") {
    data.system.resource_pressure.allowed = false;
    data.system.resource_pressure.reason =
      "Waiting for the configured batch window";
    data.summary.api_errors.count = 8;
    data.summary.worker_resource_deferred.count = 3;
  }
  return data;
}
let state = {
  sample: "ready" as SystemSample,
  data: makeData("ready"),
  url: "",
  refreshCount: 0,
};
export function subscribeSystemSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function systemSampleState() {
  return state;
}
function emit() {
  listeners.forEach((listener) => listener());
}
export function setSystemSample(sample: SystemSample) {
  state = { ...state, sample, data: makeData(sample) };
  emit();
}
async function refetch() {
  state = {
    ...state,
    data: makeData(state.sample),
    refreshCount: state.refreshCount + 1,
  };
  emit();
}
// Only the real SystemHealth page resolves these two dependencies here. No request is issued.
export function useApi<T>(url: string) {
  if (
    !/^\/api\/admin\/metrics\/dashboard\?period=(minute&minutes=60|hour&minutes=1440)$/.test(
      url,
    )
  )
    throw new Error("Unexpected metrics sample URL");
  const sample = useSyncExternalStore(subscribeSystemSample, systemSampleState);
  useEffect(() => {
    if (state.url !== url) {
      state = { ...state, url };
      emit();
    }
  }, [url]);
  return {
    data: sample.data as unknown as T,
    loading: false,
    error: null,
    refetch,
  };
}
export function useTaskCatalog() {
  return null;
}
