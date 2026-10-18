import fixture from "../../tests/admin-e2e/fixtures/roles-1al.json";
export type Sample = "ready" | "loading" | "empty" | "null";
let state = { sample: "ready" as Sample, pending: 0 };
let finishers: (() => void)[] = [];
const listeners = new Set<() => void>();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function snapshot() {
  return state;
}
function emit() {
  for (const listener of listeners) listener();
}
export function setSample(sample: Sample) {
  if (state.pending) throw new Error("Complete the sample read first");
  state = { sample, pending: 0 };
  emit();
}
function data() {
  return state.sample === "empty"
    ? { roles: [], capabilities: [] }
    : state.sample === "null"
      ? null
      : structuredClone(fixture);
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (path !== "/api/auth/roles" || method !== "GET")
    throw new Error(`Unsupported Roles sample ${method} ${path}`);
  if (state.sample !== "loading") return data() as T;
  return new Promise<T>((resolve) => {
    finishers.push(() => resolve(structuredClone(fixture) as T));
    state = { ...state, pending: finishers.length };
    emit();
  });
}
export function completeRead() {
  if (!finishers.length) throw new Error("No pending Roles sample read");
  const ready = finishers.splice(0);
  state = { ...state, pending: 0 };
  emit();
  for (const finish of ready) finish();
}
