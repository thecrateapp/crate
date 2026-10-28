import { useState, useEffect, useCallback, useRef } from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import fixture from "../../tests/admin-e2e/fixtures/new-releases-1aj.json";
export type Sample = "ready" | "loading" | "empty" | "error";
export type Access = "curate" | "acquire" | "read";
export type Outcome = "completed" | "failed" | "reject";
type Pending = { kind: "read" | "request" | "task"; finish: () => void };
let state = {
  sample: "ready" as Sample,
  access: "curate" as Access,
  outcome: "completed" as Outcome,
  pending: 0,
  failNext: false,
  action: "Sin acciones de muestra.",
};
let pending: Pending[] = [];
let responses = structuredClone(fixture);
let readsReady = true;
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
function enqueue(entry: Pending) {
  pending.push(entry);
  state = { ...state, pending: pending.length };
  emit();
}
export function setSample(sample: Sample) {
  if (pending.length) throw new Error("Complete pending sample first");
  responses = structuredClone(fixture);
  readsReady = sample !== "loading";
  if (sample === "empty") responses.releases = [];
  state = {
    ...state,
    sample,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  emit();
}
export function setAccess(access: Access) {
  state = { ...state, access };
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
function read() {
  if (state.sample === "error")
    throw new Error("Lectura de muestra no disponible");
  const data = structuredClone(responses);
  for (const release of data.releases)
    if (release.cover_url) release.cover_url = sampleArt;
  return data;
}
export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (method === "GET") {
    if (path !== "/api/acquisition/new-releases/snapshot")
      throw new Error(`Unsupported New Releases GET ${path}`);
    if (readsReady) return read() as T;
    return new Promise<T>((resolve, reject) =>
      enqueue({
        kind: "read",
        finish: () => {
          try {
            resolve(read() as T);
          } catch (error) {
            reject(error);
          }
        },
      }),
    );
  }
  const match =
    /^\/api\/acquisition\/new-releases\/(101|102|103|104|105)\/(download|dismiss)$/.exec(
      path,
    );
  if (
    method !== "POST" ||
    (!match && path !== "/api/acquisition/new-releases/check")
  )
    throw new Error(`Unsupported New Releases ${method} ${path}`);
  const fail = state.failNext;
  state = { ...state, failNext: false, action: `POST local · ${path}` };
  return new Promise<T>((resolve, reject) =>
    enqueue({
      kind: "request",
      finish: () => {
        if (fail) {
          reject(new Error("Fallo de envío de muestra"));
          return;
        }
        if (match) {
          if (match[2] === "dismiss")
            responses.releases = responses.releases.filter(
              (release) => release.id !== Number(match[1]),
            );
          else
            for (const release of responses.releases)
              if (release.id === Number(match[1]))
                release.status = "downloading";
        }
        resolve({ task_id: "sample-release-check" } as T);
      },
    }),
  );
}
export function waitForTask(taskId: string, timeout: number) {
  if (taskId !== "sample-release-check" || timeout !== 300000)
    throw new Error("Unexpected sample check contract");
  const outcome = state.outcome;
  return new Promise<{ status: string }>((resolve, reject) =>
    enqueue({
      kind: "task",
      finish: () =>
        outcome === "reject"
          ? reject(new Error("Fallo de espera de muestra"))
          : resolve({ status: outcome }),
    }),
  );
}
export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
export function advance() {
  if (!pending.length) throw new Error("No pending sample step");
  const entries =
    pending[0]!.kind === "read" ? pending.splice(0) : pending.splice(0, 1);
  readsReady = true;
  state = { ...state, pending: pending.length };
  emit();
  for (const entry of entries) entry.finish();
}
const streams = new Set<SampleEventSource>();
export const apiSseUrl = (path: string) => {
  if (path !== "/api/acquisition/new-releases/stream")
    throw new Error(`Unexpected stream ${path}`);
  return "/sample-new-releases-stream";
};
export class SampleEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(url: string) {
    if (url !== "/sample-new-releases-stream")
      throw new Error(`Unexpected sample SSE ${url}`);
    streams.add(this);
  }
  close() {
    streams.delete(this);
  }
}
export function pushStream(malformed = false) {
  if (!malformed) {
    for (const release of responses.releases)
      if (release.id === 101) release.status = "downloaded";
    state = {
      ...state,
      action: "SSE local · Luz de octubre pasa a downloaded",
    };
  } else
    state = {
      ...state,
      action: "SSE local no válido · se conserva la última lectura",
    };
  for (const stream of streams)
    stream.onmessage?.(
      new MessageEvent("message", {
        data: malformed ? "not json" : JSON.stringify(read()),
      }),
    );
  emit();
}
