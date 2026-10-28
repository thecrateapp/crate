import fixture from "../../tests/admin-e2e/fixtures/playlists-1ap.json";
export const albumCoverApiUrl = () => fixture.items[1]!.cover_data_url!;
export type Sample = "ready" | "loading" | "empty";
let items = structuredClone(fixture.items);
let state = {
  sample: "ready" as Sample,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
const listeners = new Set<() => void>();
let finishers: (() => void)[] = [];
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
export function setSample(sample: Sample) {
  if (state.pending) return;
  items = sample === "empty" ? [] : structuredClone(fixture.items);
  state = {
    ...state,
    sample,
    failNext: false,
    action: "Sin acciones de muestra.",
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
      if (fail) reject(new Error("Intentional playlist specimen failure"));
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
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (path === "/api/playlists/filter-options" && method === "GET")
    return structuredClone(fixture.filterOptions) as T;
  if (path === "/api/admin/system-playlists" && method === "GET")
    return state.sample === "loading"
      ? wait(
          "Lectura de playlists de muestra",
          () => structuredClone(items) as T,
        )
      : (structuredClone(items) as T);
  if (path === "/api/admin/system-playlists" && method === "POST")
    return wait(`${method} ${path} ${JSON.stringify(body)}`, () => {
      const created = { ...fixture.items[0]!, ...(body as object), id: 99 };
      items = [created, ...items.filter((i) => i.id !== 99)];
      return created as T;
    });
  const action =
    /^\/api\/admin\/system-playlists\/(\d+)\/(activate|deactivate)$/.exec(path);
  const deletion = /^\/api\/admin\/system-playlists\/(\d+)$/.exec(path);
  const localId = Number(action?.[1] ?? deletion?.[1]);
  if (
    ((method === "POST" && action) || (method === "DELETE" && deletion)) &&
    items.some((item) => item.id === localId)
  )
    return wait(`${method} ${path}`, () => {
      if (action)
        items = items.map((i) =>
          i.id === Number(action[1])
            ? { ...i, is_active: action[2] === "activate" }
            : i,
        );
      else if (deletion)
        items = items.filter((i) => i.id !== Number(deletion[1]));
      return {} as T;
    });
  throw new Error(`Unsupported playlist specimen ${method} ${path}`);
}
