import { useState, useEffect, useCallback, useRef } from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import fixture from "../../tests/admin-e2e/fixtures/global-catalog-1ak.json";
export type Sample = "ready" | "loading" | "empty" | "error";
export type Serving =
  | "global-ready"
  | "global-refreshing"
  | "global-degraded"
  | "local-fallback";
let state = {
  sample: "ready" as Sample,
  serving: "global-ready" as Serving,
  manage: true,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
type Entry = { kind: "read" | "request"; finish: () => void };
let pending: Entry[] = [];
let holdReads = false;
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
function enqueue(entry: Entry) {
  pending.push(entry);
  state = { ...state, pending: pending.length };
  emit();
}
export function setSample(sample: Sample) {
  if (pending.length) throw new Error("Complete pending sample first");
  holdReads = sample === "loading";
  state = {
    ...state,
    sample,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  emit();
}
export function setServing(serving: Serving) {
  if (pending.length) throw new Error("Complete pending sample first");
  state = { ...state, serving };
  emit();
}
export function setManage(manage: boolean) {
  state = { ...state, manage };
  emit();
}
export function setFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}
function read(path: string): unknown {
  if (!(path in fixture))
    throw new Error(`Unsupported Global Catalog GET ${path}`);
  if (state.sample === "error")
    throw new Error("Lectura de muestra no disponible");
  if (path.endsWith("/status")) {
    const status = structuredClone(fixture["/api/admin/global-catalog/status"]);
    status.serving_mode = state.serving;
    if (state.sample === "empty") {
      status.counts = { artists: 0, albums: 0, tracks: 0, sources: 0 };
      return {
        ...status,
        last_run: null,
        stale_peer_count: 0,
        ambiguous_candidate_count: 0,
      };
    }
    return status;
  }
  if (state.sample === "empty") return { items: [] };
  return structuredClone((fixture as Record<string, unknown>)[path]);
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method === "GET") {
    if (!holdReads) return read(path) as T;
    return new Promise<T>((resolve, reject) =>
      enqueue({
        kind: "read",
        finish: () => {
          try {
            resolve(read(path) as T);
          } catch (error) {
            reject(error);
          }
        },
      }),
    );
  }
  const mode = (body as { mode?: unknown } | undefined)?.mode;
  if (
    method !== "POST" ||
    path !== "/api/admin/global-catalog/reconcile" ||
    !["incremental", "full"].includes(String(mode))
  )
    throw new Error(`Unsupported Global Catalog action ${method} ${path}`);
  const fail = state.failNext;
  state = {
    ...state,
    failNext: false,
    action: `POST local · ${path} · ${mode}`,
  };
  return new Promise<T>((resolve, reject) =>
    enqueue({
      kind: "request",
      finish: () => {
        if (fail) {
          reject(new Error("Fallo de envío de muestra"));
          return;
        }
        holdReads = true;
        resolve({ task_id: "sample-catalog-task", status: "queued" } as T);
      },
    }),
  );
}
export function advance() {
  if (!pending.length) throw new Error("No pending sample step");
  const entries =
    pending[0]!.kind === "read"
      ? pending.filter((entry) => entry.kind === "read")
      : pending.splice(0, 1);
  if (entries[0]!.kind === "read")
    pending = pending.filter((entry) => entry.kind !== "read");
  if (entries[0]!.kind === "read") holdReads = false;
  state = { ...state, pending: pending.length };
  emit();
  for (const entry of entries) entry.finish();
}
export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
