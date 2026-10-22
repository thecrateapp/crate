import { useState } from "react";

export interface ActionLLMStatus {
  action_id: string;
  available: boolean;
  status: "legacy" | "configured" | "unavailable";
  provider: string | null;
  model_id: string | null;
  fingerprint: string | null;
  error_code: string | null;
}

type Sample = "ready" | "loading" | "error";
let sample: Sample = "ready";
let action = "Sample data ready. No backend is connected.";
const listeners = new Set<() => void>();
let snapshot: { sample: Sample; action: string } = { sample, action };

function emit() {
  snapshot = { sample, action };
  for (const listener of listeners) listener();
}

export function subscribeSettingsSample(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function settingsSampleSnapshot() {
  return snapshot;
}

export function setSettingsSample(next: Sample) {
  sample = next;
  action =
    next === "error"
      ? "The settings snapshot is unavailable; Retry returns to sample data."
      : next === "loading"
        ? "Loading sample settings."
        : "Sample data ready. No backend is connected.";
  emit();
}

const settingsData = {
  schedules: { library_sync: 3600, enrich_artists: 0, release_radar: 7200 },
  worker: { max_workers: 5 },
  enrichment: {
    lastfm: true,
    spotify: true,
    fanart: true,
    setlistfm: true,
    musicbrainz: true,
  },
  db_stats: {
    library_tracks: { size: 1024 * 1024 * 22, rows: 48210 },
    library_albums: { size: 1024 * 1024 * 8, rows: 4390 },
  },
  library: {
    path: "/music",
    storage_layout: "artist/album",
    audio_extensions: [".flac", ".mp3", ".ogg", ".opus"],
  },
  processing: {
    mb_auto_apply_threshold: 92,
    enrichment_min_age_hours: 24,
    max_track_popularity: 65,
  },
  paths: { llm_refinement_enabled: true, llm_refinement_cache_ttl_hours: 168 },
  soulseek: {
    url: "http://slskd:5030",
    quality: "flac",
    min_bitrate: 320,
    username: "crate-review",
    shares_music: false,
  },
  telegram: {
    enabled: true,
    bot_token: "",
    chat_id: "review-room",
    has_token: true,
  },
  about: {
    version: "3.0.0-review",
    git_commit: "a5c-review",
    python: "3.13",
    uptime_seconds: 86400 + 7200 + 180,
    artists: 903,
    albums: 4390,
    tracks: 48210,
    total_size_gb: 1200,
  },
};

const acquisitionStatus = {
  tidal: { authenticated: false },
  soulseek: { connected: true, state: "ready" },
};

const downloadPolicy = {
  downloads_allowed_now: true,
  active_users: 2,
  active_streams: 4,
  time_window: {
    enabled: true,
    in_window: false,
    start: "02:00",
    end: "06:00",
  },
  user_limit: { enabled: true, max: 4 },
  stream_limit: { enabled: true, max: 12 },
};

export function useApi<T>(path: string) {
  const [, setRevision] = useState(0);
  const failed = sample === "error" && path === "/api/settings";
  const data =
    path === "/api/settings"
      ? failed
        ? null
        : settingsData
      : path === "/api/acquisition/status"
        ? acquisitionStatus
        : path === "/api/admin/download-policy"
          ? downloadPolicy
          : path === "/api/admin/audit-log"
            ? { entries: [], total: 0, limit: 25, offset: 0 }
            : null;
  const refetch = () => {
    if (failed) setSettingsSample("ready");
    setRevision((revision) => revision + 1);
  };
  return {
    data: data as T | null,
    loading: sample === "loading",
    error: failed ? new Error("Sample settings unavailable") : null,
    refetch,
  };
}

export async function api<T>(
  path: string,
  method = "GET",
  _body?: unknown,
): Promise<T> {
  if (path === "/api/settings") return settingsData as T;
  if (path === "/api/admin/task-catalog")
    return {
      categories: { library: "Library", enrichment: "Enrichment" },
      types: [
        { type: "library_sync", label: "Library Scan", category: "library" },
        {
          type: "enrich_artists",
          label: "Artist Enrichment",
          category: "enrichment",
        },
        { type: "release_radar", label: "Release Radar", category: "library" },
      ],
      actions: [],
    } as T;
  action = `${method} ${path} · simulated locally`;
  emit();
  if (path.endsWith("/run")) return { status: "queued" } as T;
  return { ok: true, success: true } as T;
}

export function useActionLLMStatus(actionId: string): ActionLLMStatus {
  return {
    action_id: actionId,
    available: true,
    status: "configured",
    provider: "sample",
    model_id:
      actionId === "i18n.listen.draft" ? "local-translation" : "local-paths",
    fingerprint: "local-review",
    error_code: null,
  };
}

export function useOpsSnapshot() {
  return {
    data: {
      live: { engine: "Dramatiq", running_tasks: [], db_heavy_gate: null },
      stats: { pending_tasks: 0 },
    },
  };
}

export function useTaskCatalog() {
  return { categories: {}, types: [], actions: [] };
}

export function taskLabel(taskType: string) {
  return (
    {
      library_sync: "Library Scan",
      enrich_artists: "Artist Enrichment",
      release_radar: "Release Radar",
    }[taskType] ?? taskType.replace(/_/g, " ")
  );
}

export function installSettingsFetchSample() {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.href);
    if (url.pathname === "/api/tidal/auth/login" && init?.method === "POST")
      return new Response(null, { status: 503, statusText: "Sample only" });
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}
