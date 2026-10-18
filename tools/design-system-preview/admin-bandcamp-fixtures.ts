import { useState, useEffect, useCallback, useRef } from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import fixture from "../../tests/admin-e2e/fixtures/bandcamp-1ah.json";
export type Sample = "ready" | "disconnected" | "empty" | "checking";
let state = {
  sample: "ready" as Sample,
  pending: false,
  failNext: false,
  action: "Sin acciones de muestra.",
};
const listeners = new Set<() => void>();
let responses: Record<string, unknown> = structuredClone(fixture);
let readsReady = true;
let finishers: (() => void)[] = [];
function emit() {
  for (const listener of listeners) listener();
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
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
  if (state.pending) throw new Error("Complete the pending sample first");
  state = {
    sample,
    pending: false,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  responses = structuredClone(fixture);
  readsReady = sample !== "checking";
  if (sample === "disconnected")
    responses["/api/bandcamp/me/status"] = { connected: false };
  if (sample === "empty")
    for (const path of Object.keys(responses)) {
      if (!path.endsWith("/status"))
        responses[path] = path.endsWith("/imports")
          ? { imports: [], total: 0 }
          : { items: [], total: 0 };
    }
  emit();
}
function localize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "item_url" && typeof item === "string"
          ? `/admin-bandcamp-demo.html?destino=${encodeURIComponent(item)}`
          : localize(item),
      ]),
    );
  return value;
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (method === "GET") {
    if (!(path in responses))
      throw new Error(`Unsupported Bandcamp specimen GET: ${path}`);
    if (readsReady) return localize(structuredClone(responses[path])) as T;
    state = { ...state, pending: true };
    emit();
    return new Promise<T>((resolve) => {
      finishers.push(() =>
        resolve(localize(structuredClone(responses[path])) as T),
      );
    });
  }
  const match =
    /^\/api\/bandcamp\/admin\/matches\/(71|72)\/(confirm|reject)$/.exec(path);
  const queue = [
    "/api/bandcamp/me/sync",
    "/api/bandcamp/me/radar/refresh",
    "/api/bandcamp/admin/backfill-urls?limit=250&public_search=true",
  ].includes(path);
  if (method !== "POST" || (!queue && !match) || state.pending)
    throw new Error(`Unsupported Bandcamp specimen action: ${method} ${path}`);
  const fail = state.failNext;
  state = {
    ...state,
    pending: true,
    failNext: false,
    action: `POST local · ${path}`,
  };
  emit();
  return new Promise<T>((resolve, reject) => {
    finishers.push(() => {
      if (fail) {
        reject(new Error("Fallo de acción de muestra"));
        return;
      }
      if (match) {
        const payload = responses[
          "/api/bandcamp/admin/matches?limit=100"
        ] as (typeof fixture)["/api/bandcamp/admin/matches?limit=100"];
        const item = payload.items.find((item) => item.id === Number(match[1]));
        if (item)
          item.status = match[2] === "confirm" ? "confirmed" : "rejected";
      }
      resolve({ task_id: "sample-bandcamp-task", status: "queued" } as T);
    });
  });
}
export function complete() {
  if (!state.pending) throw new Error("No pending Bandcamp sample");
  readsReady = true;
  const callbacks = finishers;
  finishers = [];
  state = { ...state, pending: false };
  emit();
  for (const callback of callbacks) callback();
}
export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
