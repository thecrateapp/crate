import { useState, useEffect, useCallback, useRef } from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import fixture from "../../tests/admin-e2e/fixtures/discovery-1ai.json";
export type Sample = "ready" | "loading" | "empty" | "error" | "partial-error";
export type Outcome = "complete" | "partial" | "skipped" | "failed";
type Entry = { kind: "read" | "request" | "task"; finish: () => void };
let state = {
  sample: "ready" as Sample,
  outcome: "complete" as Outcome,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
let readsReady = true;
let pending: Entry[] = [];
const listeners = new Set<() => void>();
export const sampleArt = new URL("./discovery-sample-art.svg", import.meta.url)
  .href;
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
  if (state.pending) throw new Error("Complete pending sample first");
  readsReady = sample !== "loading";
  state = {
    sample,
    outcome: "complete",
    pending: 0,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  emit();
}
export function setOutcome(outcome: Outcome) {
  state = { ...state, outcome };
  emit();
}
export function setFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}
function result(path: string): unknown {
  if (state.sample === "error")
    throw new Error("Lectura de muestra no disponible");
  if (state.sample === "partial-error" && path === "/api/discover/completeness")
    throw new Error("Lectura de cobertura de muestra no disponible");
  if (state.sample === "empty") {
    if (path === "/api/discover/completeness") return [];
    if (path.startsWith("/api/acquisition/")) return { releases: [] };
    return { popularity: [], top_albums: [], top_genres: [] };
  }
  const data = structuredClone((fixture as Record<string, unknown>)[path]);
  if (path.startsWith("/api/acquisition/")) {
    const releases =
      data as (typeof fixture)["/api/acquisition/new-releases?status=detected"];
    for (const release of releases.releases)
      if (release.cover_url) release.cover_url = sampleArt;
  }
  return data;
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (method === "GET") {
    if (!(path in fixture))
      throw new Error(`Unsupported Discovery specimen GET: ${path}`);
    if (readsReady) return result(path) as T;
    return new Promise<T>((resolve, reject) =>
      enqueue({
        kind: "read",
        finish: () => {
          try {
            resolve(result(path) as T);
          } catch (error) {
            reject(error);
          }
        },
      }),
    );
  }
  if (
    method !== "POST" ||
    ![
      "/api/discover/completeness/refresh",
      "/api/acquisition/new-releases/check",
    ].includes(path)
  )
    throw new Error(`Unsupported Discovery specimen action: ${method} ${path}`);
  const fail = state.failNext;
  state = { ...state, failNext: false, action: `POST local · ${path}` };
  return new Promise<T>((resolve, reject) =>
    enqueue({
      kind: "request",
      finish: () =>
        fail
          ? reject(new Error("Fallo de envío de muestra"))
          : resolve({ task_id: "sample-discovery-task" } as T),
    }),
  );
}
export function advance() {
  if (!pending.length) throw new Error("No pending sample operation");
  const entries =
    pending[0]!.kind === "read" ? pending.splice(0) : pending.splice(0, 1);
  readsReady = true;
  state = { ...state, pending: pending.length };
  emit();
  for (const entry of entries) entry.finish();
}
export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
export function useTaskPoll() {
  useEffect(
    () => () => {
      pending = [];
      state = { ...state, pending: 0 };
      emit();
    },
    [],
  );
  return {
    pollTask: (
      id: string,
      onComplete: (result?: Record<string, unknown>) => void,
      onFailed?: (error?: string) => void,
      interval?: number,
      timeout?: number,
    ) => {
      if (
        id !== "sample-discovery-task" ||
        interval !== 3000 ||
        timeout !== 1800000
      )
        throw new Error("Unsupported sample task contract");
      state = { ...state, action: `Tarea local · ${id}` };
      enqueue({
        kind: "task",
        finish: () => {
          if (state.outcome === "failed")
            onFailed?.("Fallo de tarea de muestra");
          else
            onComplete(
              state.outcome === "partial"
                ? { partial: true, failed_artists: 2 }
                : state.outcome === "skipped"
                  ? { cache_written: false }
                  : {},
            );
        },
      });
    },
  };
}
