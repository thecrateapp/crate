import { useEffect, useSyncExternalStore } from "react";
import fixture from "../../tests/admin-e2e/fixtures/system-health-1ac.json";
export { taskLabel } from "../../app/ui/src/lib/task-catalog";

export type SystemSample = "ready" | "pressure";
const listeners = new Set<() => void>();
function makeData(sample: SystemSample) {
  const data = structuredClone(fixture);
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
  state = { ...state, refreshCount: state.refreshCount + 1 };
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
