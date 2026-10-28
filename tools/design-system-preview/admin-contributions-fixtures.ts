import fixture from "../../tests/admin-e2e/fixtures/contributions-1af.json";

type Sample = "ready" | "loading" | "empty" | "error";
type Payload = { items: typeof fixture.items; count: number };
let state = { sample: "ready" as Sample, pending: false, reads: 0 };
let finish: (() => void) | undefined;
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
export function subscribeContributionsSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function contributionsSampleState() {
  return state;
}
export function setContributionsSample(sample: Sample) {
  if (state.pending) throw new Error("Complete the pending sample read first");
  state = { sample, pending: false, reads: 0 };
  emit();
}
function result(): Payload {
  if (state.sample === "error")
    throw new Error("Lectura de muestra no disponible");
  return state.sample === "empty"
    ? { items: [], count: 0 }
    : structuredClone(fixture);
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (path !== "/api/manage/contributions?limit=150" || method !== "GET")
    throw new Error(
      `Unsupported Contributions specimen request: ${method} ${path}`,
    );
  if (state.pending) throw new Error("Overlapping sample read");
  state = { ...state, reads: state.reads + 1 };
  if (state.sample !== "loading" && state.reads === 1) {
    emit();
    return result() as T;
  }
  state = { ...state, pending: true };
  emit();
  return new Promise<T>((resolve, reject) => {
    finish = () => {
      finish = undefined;
      state = { ...state, pending: false };
      emit();
      try {
        resolve(result() as T);
      } catch (error) {
        reject(error);
      }
    };
  });
}
export function completeContributionsRead() {
  if (!finish) throw new Error("No sample read pending");
  finish();
}
