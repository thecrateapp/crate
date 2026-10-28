import fixture from "../../tests/admin-e2e/fixtures/trash-1ae.json";
import type { TaskCompletion } from "../../app/ui/src/lib/tasks";

type Sample = "ready" | "loading" | "empty";
type Operation = "restore" | "hard-delete" | "hard-delete-all";
type Pending = {
  id: string;
  operation: Operation;
  path?: string;
  fail: boolean;
};
const listeners = new Set<() => void>();
let items = structuredClone(fixture.items);
let sequence = 0;
let complete: ((task: TaskCompletion) => void) | undefined;
let state = {
  sample: "ready" as Sample,
  pending: null as Pending | null,
  failNext: false,
  action: "Sin acciones de muestra.",
};
function emit() {
  listeners.forEach((listener) => listener());
}
export function subscribeTrashSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function trashSampleState() {
  return state;
}
export function setTrashSample(sample: Sample) {
  if (state.pending) return;
  items = sample === "empty" ? [] : structuredClone(fixture.items);
  state = {
    sample,
    pending: null,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  emit();
}
export function setTrashFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}

// Only Trash.tsx resolves API/task dependencies here. Unknown paths fail closed; no fetch/SSE.
export async function api<T>(
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  if (path === "/api/manage/tracks/quarantine" && method === "GET") {
    if (state.sample === "loading") return new Promise(() => {});
    return { items: structuredClone(items), count: items.length } as T;
  }
  const operation = path.replace(
    "/api/manage/tracks/quarantine/",
    "",
  ) as Operation;
  if (
    method !== "POST" ||
    !["restore", "hard-delete", "hard-delete-all"].includes(operation) ||
    path !== `/api/manage/tracks/quarantine/${operation}` ||
    state.pending
  )
    throw new Error("Unexpected Trash sample request");
  const selected =
    typeof body?.quarantine_path === "string"
      ? body.quarantine_path
      : undefined;
  if (
    operation !== "hard-delete-all" &&
    !items.some((item) => item.quarantine_path === selected)
  )
    throw new Error("Unknown Trash sample path");
  const id = `sample-trash-${++sequence}`;
  state = {
    ...state,
    pending: { id, operation, path: selected, fail: state.failNext },
    failNext: false,
    action: `POST ${path} · ${selected ?? "toda la muestra"}`,
  };
  emit();
  return { task_id: id } as T;
}
export function waitForTask(
  id: string,
  timeout: number,
): Promise<TaskCompletion> {
  if (
    id !== state.pending?.id ||
    timeout !==
      (state.pending.operation === "hard-delete-all" ? 600000 : 120000)
  )
    return Promise.reject(new Error("Unexpected Trash sample task"));
  return new Promise((resolve) => {
    complete = resolve;
  });
}
export function completeTrashTask() {
  const pending = state.pending;
  if (!pending || !complete) return;
  const removed = items.filter(
    (item) =>
      pending.operation === "hard-delete-all" ||
      item.quarantine_path === pending.path,
  );
  if (!pending.fail) items = items.filter((item) => !removed.includes(item));
  const resolve = complete;
  complete = undefined;
  state = { ...state, pending: null };
  emit();
  resolve(
    pending.fail
      ? { status: "failed", error: "Fallo de tarea de muestra" }
      : {
          status: "completed",
          result: {
            deleted: removed.length,
            bytes_deleted: removed.reduce(
              (sum, item) => sum + item.size_bytes,
              0,
            ),
          },
        },
  );
}
