import fixture from "../../tests/admin-e2e/fixtures/upcoming-1ao.json";
export { artistPagePath } from "../../app/ui/src/lib/library-routes";
export const sampleImage = fixture.items[0]!.cover_url!;
export const artistPhotoApiUrl = () => sampleImage;
export const artistBackgroundApiUrl = () => sampleImage;
export type Sample = "ready" | "loading" | "empty";
export type Access = "admin" | "acquire" | "shows";
let state = {
  sample: "ready" as Sample,
  access: "admin" as Access,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
let items = structuredClone(fixture.items);
let finishers: (() => void)[] = [];
const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function snapshot() {
  return state;
}
export function setFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}
export function setAccess(access: Access) {
  state = { ...state, access };
  emit();
}
export function setSample(sample: Sample) {
  if (state.pending) return;
  items = sample === "empty" ? [] : structuredClone(fixture.items);
  state = {
    ...state,
    sample,
    action: "Sin acciones de muestra.",
    failNext: false,
  };
  emit();
}
function wait<T>(label: string, done: () => T): Promise<T> {
  const fail = state.failNext;
  state = {
    ...state,
    pending: state.pending + 1,
    failNext: false,
    action: label,
  };
  emit();
  return new Promise((resolve, reject) => {
    finishers.push(() => {
      state = {
        ...state,
        pending: state.pending - 1,
        action: fail
          ? "Fallo de muestra. Reintenta la acción."
          : label + " · Completado localmente.",
      };
      if (fail) reject(new Error("Intentional upcoming sample failure"));
      else resolve(done());
      emit();
    });
  });
}
export function complete() {
  const queue = finishers;
  finishers = [];
  for (const fn of queue) fn();
}
function localItems() {
  return structuredClone(items).map((item) => ({
    ...item,
    url: item.url
      ? `/admin-upcoming-demo.html?destino=${encodeURIComponent(item.url)}`
      : undefined,
  }));
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (path === "/api/upcoming" && method === "GET")
    return state.sample === "loading"
      ? wait(
          "Lectura de Upcoming de muestra",
          () => ({ items: localItems() }) as T,
        )
      : ({ items: localItems() } as T);
  if (method !== "POST")
    throw new Error(`Unsupported upcoming specimen ${method} ${path}`);
  const release =
    /^\/api\/acquisition\/new-releases\/(71|72|73|74)\/(download|dismiss)$/.exec(
      path,
    );
  if (
    !release &&
    !["/api/tasks/sync-shows", "/api/tasks/clean/completed"].includes(path)
  )
    throw new Error("Unsupported upcoming specimen action");
  return wait(`${method} ${path}`, () => {
    if (release) {
      const id = Number(release[1]);
      if (release[2] === "dismiss")
        items = items.filter((i) => i.release_id !== id);
      else
        items = items.map((i) =>
          i.release_id === id ? { ...i, status: "downloading" } : i,
        );
    }
    return { task_id: "sample-upcoming-task" } as T;
  });
}
