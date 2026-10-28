import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createUseApi } from "../../app/shared/web/use-api";
import fixture from "../../tests/admin-e2e/fixtures/playlist-editor-1aq.json";
export { ApiError } from "../../app/shared/web/api";
export type Sample = "smart" | "static" | "loading" | "missing" | "failed";
type Playlist = Omit<
  typeof fixture.surface.playlist,
  "cover_data_url" | "smart_rules"
> & {
  cover_data_url: string | null;
  smart_rules: typeof fixture.surface.playlist.smart_rules | null;
};
let surface: {
  playlist: Playlist;
  history: typeof fixture.surface.history;
  snapshot: null;
} = structuredClone(fixture.surface);
let state = {
  sample: "smart" as Sample,
  pending: false,
  failNext: false,
  llm: true,
  action: "Sin acciones de muestra.",
};
const listeners = new Set<() => void>();
let finishers: (() => void)[] = [];
let readsReady = true;
let nextTrackRowId =
  Math.max(...fixture.surface.playlist.tracks.map((track) => track.id)) + 1;
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
export function setLLM(llm: boolean) {
  state = { ...state, llm };
  emit();
}
export function useLLMStatus() {
  const { llm } = useSyncExternalStore(subscribe, snapshot);
  return {
    available: llm,
    model: "sample",
    provider: "local",
    error: llm ? null : "IA no disponible en la muestra",
  };
}
export function useActionLLMStatus(actionId: string) {
  const { llm } = useSyncExternalStore(subscribe, snapshot);
  return {
    action_id: actionId,
    available: llm,
    status: llm ? ("configured" as const) : ("unavailable" as const),
    provider: llm ? "local" : null,
    model_id: llm ? "sample" : null,
    fingerprint: llm ? "sample" : null,
    error_code: llm ? null : "unavailable",
  };
}

export function useSnapshotStream<T>(
  url: string | null,
  onPayload: (payload: T) => void,
): "idle" | "connecting" | "live" | "reconnecting" {
  const onPayloadRef = useRef(onPayload);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "live" | "reconnecting"
  >(url ? "connecting" : "idle");

  useEffect(() => {
    onPayloadRef.current = onPayload;
  }, [onPayload]);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    let disposed = false;
    const stream = new EditorEventSource(url);
    stream.onopen = () => {
      if (!disposed) setStatus("live");
    };
    stream.onmessage = (event) => {
      if (disposed) return;
      try {
        onPayloadRef.current(JSON.parse(event.data) as T);
      } catch {
        // Invalid fixture frames leave the last snapshot visible.
      }
    };
    queueMicrotask(() => stream.onopen?.());

    return () => {
      disposed = true;
      stream.close();
    };
  }, [url]);

  return status;
}
export function setSample(sample: Sample) {
  if (state.pending) throw new Error("Complete the pending sample first");
  state = {
    ...state,
    sample,
    failNext: false,
    llm: true,
    action: "Sin acciones de muestra.",
  };
  surface = structuredClone(fixture.surface);
  nextTrackRowId =
    Math.max(...surface.playlist.tracks.map((track) => track.id)) + 1;
  readsReady = sample !== "loading";
  if (sample === "static")
    Object.assign(surface.playlist, {
      is_smart: false,
      generation_mode: "static",
      smart_rules: null,
    });
  if (sample === "failed")
    Object.assign(surface.playlist, {
      generation_status: "failed",
      generation_error: "Fallo de generación de muestra. Puedes reintentar.",
    });
  emit();
}
const prefix = "/api/admin/system-playlists/42";
export const apiSseUrl = (path: string) => path;
const streams = new Set<EditorEventSource>();
// Constructor injected only into the preview's real PlaylistEditor module, never window.
export class EditorEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    if (url !== `${prefix}/stream`)
      throw new Error(`Unsupported sample stream: ${url}`);
    streams.add(this);
  }
  close() {
    streams.delete(this);
  }
}
export function pushStream() {
  surface.playlist.generation_status =
    surface.playlist.generation_status === "running" ? "idle" : "running";
  for (const stream of streams)
    stream.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(surface) }),
    );
  state = {
    ...state,
    action: `SSE local · ${surface.playlist.generation_status}`,
  };
  emit();
}
function pending<T>(result: () => T, fail = false): Promise<T> {
  state = { ...state, pending: true };
  emit();
  return new Promise((resolve, reject) => {
    finishers.push(() =>
      fail
        ? reject(new Error("Fallo de acción de muestra"))
        : resolve(result()),
    );
  });
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method === "GET") {
    if (path === "/api/playlists/filter-options")
      return structuredClone(fixture.filterOptions) as T;
    if (path === `${prefix}/editor-snapshot`) {
      const result = () =>
        state.sample === "missing" ? null : structuredClone(surface);
      return (readsReady ? result() : pending(result)) as T;
    }
    if (path.startsWith(`${prefix}/track-search?`)) {
      const params = new URL(path, "http://localhost").searchParams;
      const q = params.get("q")?.toLowerCase() ?? "";
      const result = {
        tracks: fixture.candidates.filter((t) =>
          `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q),
        ),
        scope: params.get("scope"),
      };
      return pending(() => structuredClone(result)) as Promise<T>;
    }
    throw new Error(`Unsupported editor specimen GET: ${path}`);
  }
  const supported =
    (method === "PUT" && path === prefix) ||
    (method === "POST" &&
      [
        "/preview",
        "/generate",
        "/duplicate",
        "/ai-description",
        "/tracks",
        "/tracks/reorder",
        "/refine",
        "/refine/apply",
      ].some((s) => path === `${prefix}${s}`)) ||
    (method === "DELETE" &&
      /^\/api\/admin\/system-playlists\/42\/tracks\/\d+$/.test(path));
  if (!supported || state.pending)
    throw new Error(`Unsupported editor specimen action: ${method} ${path}`);
  const fail = state.failNext;
  state = {
    ...state,
    failNext: false,
    action: `${method} local · ${path} · ${JSON.stringify(body ?? null)}`,
  };
  const patch = (body ?? {}) as Partial<Playlist> & { track_ids?: number[] };
  return pending(() => {
    if (path.endsWith("/preview")) return structuredClone(fixture.preview) as T;
    if (path.endsWith("/ai-description"))
      return structuredClone(fixture.description) as T;
    if (path.endsWith("/refine")) return structuredClone(fixture.proposal) as T;
    if (path.endsWith("/duplicate"))
      return { ...surface.playlist, id: 99 } as T;
    if (method === "PUT") Object.assign(surface.playlist, patch);
    if (path.endsWith("/generate") || (method === "PUT" && patch.smart_rules))
      surface.playlist.generation_status = "queued";
    if (path.endsWith("/tracks"))
      surface.playlist.tracks.push({
        ...fixture.candidates[0]!,
        id: nextTrackRowId++,
        playlist_id: 42,
        position: surface.playlist.tracks.length + 1,
        locked: true,
        source: "manual",
      });
    if (path.endsWith("/tracks/reorder"))
      surface.playlist.tracks.sort(
        (a, b) =>
          (patch.track_ids?.indexOf(a.id) ?? 0) -
          (patch.track_ids?.indexOf(b.id) ?? 0),
      );
    if (method === "DELETE")
      surface.playlist.tracks = surface.playlist.tracks.filter(
        (t) => t.position !== Number(path.split("/").slice(-1)[0]),
      );
    if (path.endsWith("/refine/apply"))
      surface.playlist.tracks = surface.playlist.tracks.filter(
        (t) => t.track_id !== 11,
      );
    surface.playlist.tracks = surface.playlist.tracks.map((t, i) => ({
      ...t,
      position: i + 1,
    }));
    surface.playlist.track_count = surface.playlist.tracks.length;
    surface.playlist.total_duration = surface.playlist.tracks.reduce(
      (sum, t) => sum + t.duration,
      0,
    );
    if (path.endsWith("/refine/apply"))
      return { ok: true, applied_count: 1 } as T;
    if (path.endsWith("/generate"))
      return {
        ...structuredClone(surface.playlist),
        generated_track_count: surface.playlist.track_count,
      } as T;
    return structuredClone(surface.playlist) as T;
  }, fail);
}
export function complete() {
  if (!state.pending) throw new Error("No pending editor sample");
  const callbacks = finishers;
  finishers = [];
  readsReady = true;
  state = { ...state, pending: false };
  emit();
  for (const callback of callbacks) callback();
}
export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);
