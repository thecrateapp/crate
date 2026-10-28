import { useSyncExternalStore } from "react";

export type FederationSample = "ready" | "loading" | "error" | "empty";

const sampleNode = {
  node_uid: "crate:review-local-01",
  display_name: "Crate Review Node",
  api_base_url: "https://review.crate.example",
  active_key_id: "local-ed25519-2026",
};

const samplePeers = [
  {
    node_uid: "crate:berlin-02",
    display_name: "Berlin Listening Room",
    api_base_url: "https://berlin.crate.example",
    trust_state: "approved",
    default_grant_preset: "trusted_library",
    health_json: { status: "healthy" },
    last_health_at: "2026-10-22T10:30:00Z",
    disabled_at: null,
  },
  {
    node_uid: "crate:oslo-01",
    display_name: "Oslo Archive",
    api_base_url: "https://oslo.crate.example",
    trust_state: "pending",
    default_grant_preset: "discovery",
    health_json: { status: "pending" },
    last_health_at: null,
    disabled_at: null,
  },
];

const sampleStatus = {
  local_node: sampleNode,
  peer_count: 2,
  approved_peer_count: 1,
  pending_pairing_count: 1,
  key_health: { status: "healthy" },
  peers: samplePeers,
};

const sampleStreams = {
  peers: [
    {
      node_uid: "crate:berlin-02",
      display_name: "Berlin Listening Room",
      preset: "trusted_library",
      active_streams: 2,
      daily_bytes: 734003200,
    },
  ],
};

const sampleImports = [
  {
    request_id: "import-review-184",
    node_uid: "crate:berlin-02",
    title: "Soft Landing",
    status: "awaiting_approval",
    requested_by_user_id: 42,
    expected_bytes: 42800000,
    reserved_bytes: 42800000,
    received_bytes: 0,
    manifest_digest: "sha256:9f3b8d72a4c16e01",
    metadata_json: { global_album_uid: "global:soft-landing-2026" },
    created_at: "2026-10-22T09:48:00Z",
  },
];

const sampleDirectories = [
  {
    subscription_uid: "directory-review-01",
    url: "https://directory.crate.example/nodes.json",
    trusted_keys_json: [{ key_id: "crate-directory-2026" }],
    refresh_interval_seconds: 3600,
    state: "active",
    last_success_at: "2026-10-22T09:00:00Z",
    last_error_code: null,
    last_error_detail: null,
    candidates: [
      {
        id: 84,
        node_uid: "crate:lisbon-03",
        display_name: "Lisbon Independent Archive",
        descriptor_url: "https://lisbon.crate.example/.well-known/crate-node",
        descriptor_digest: "sha256:2d879e0a8b63f1c4",
        state: "pending",
        metadata_json: { api_base_url: "https://lisbon.crate.example" },
        peer_trust_state: null,
      },
    ],
  },
];

const sampleTickets = [
  {
    ticket_uid: "stream-ticket-91b",
    node_uid: "crate:berlin-02",
    subject_hash: "sha256:4a88d1",
    expires_at: "2026-10-22T12:30:00Z",
  },
];

const sampleRisk = {
  latest_snapshot: { score: 18, algorithm_version: "federation-risk-v2" },
  observations: [
    {
      id: 1,
      observation_type: "failed_authentication",
      count: 1,
      severity: "low",
    },
    { id: 2, observation_type: "rate_limit", count: 0, severity: "info" },
  ],
  temporary_actions: [],
};

const sampleAudit = [
  {
    id: 284,
    node_uid: "crate:berlin-02",
    event_type: "stream_ticket_issued",
    status: "success",
    created_at: "2026-10-22T10:26:00Z",
  },
  {
    id: 283,
    node_uid: "crate:oslo-01",
    event_type: "pairing_requested",
    status: "pending",
    created_at: "2026-10-22T09:52:00Z",
  },
];

let sample: FederationSample = "ready";
let action = "Sample data ready. No backend is connected.";
const listeners = new Set<() => void>();
let revision = 0;
let stateSnapshot: {
  sample: FederationSample;
  action: string;
  revision: number;
} = { sample, action, revision };

function emit() {
  revision += 1;
  stateSnapshot = { sample, action, revision };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot() {
  return stateSnapshot;
}

export function setSample(next: FederationSample) {
  sample = next;
  action =
    next === "ready"
      ? "Sample data ready. No backend is connected."
      : next === "loading"
        ? "Federation sample is loading."
        : next === "error"
          ? "Federation sample failed; switch to data to retry."
          : "Empty federation sample is active.";
  emit();
}

export function installFederationFetchSample() {
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const requestUrl =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    const url = new URL(requestUrl, window.location.origin);
    if (!url.pathname.startsWith("/api/admin/federation/"))
      return originalFetch(input, init);

    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "GET" && sample === "loading") {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : null);
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Request aborted", "AbortError")),
          { once: true },
        );
      });
    }
    if (method === "GET" && sample === "error")
      return Response.json(
        { detail: "Sample federation error" },
        { status: 503 },
      );

    const payload =
      method === "GET"
        ? responseFor(url.pathname + url.search)
        : { ok: true, success: true };
    return Response.json(payload);
  };

  return () => {
    window.fetch = originalFetch;
  };
}

export function noteAction(next: string) {
  action = `${next} · simulated locally.`;
  emit();
}

function responseFor(path: string) {
  if (path.endsWith("/status")) {
    return sample === "empty"
      ? {
          ...sampleStatus,
          peer_count: 0,
          approved_peer_count: 0,
          pending_pairing_count: 0,
          peers: [],
        }
      : sampleStatus;
  }
  if (path.endsWith("/streaming-stats"))
    return sample === "empty" ? { peers: [] } : sampleStreams;
  if (path.endsWith("/import-requests"))
    return sample === "empty" ? [] : sampleImports;
  if (path.endsWith("/directories"))
    return sample === "empty" ? [] : sampleDirectories;
  if (path.endsWith("/streams")) return sample === "empty" ? [] : sampleTickets;
  if (path.includes("/risk?node_uid=")) return sampleRisk;
  if (path.includes("/audit?limit="))
    return sample === "empty" ? [] : sampleAudit;
  return {};
}

export function useApi<T>(path: string | null) {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    data: path && state.sample !== "error" ? (responseFor(path) as T) : null,
    loading: !!path && state.sample === "loading",
    error: path && state.sample === "error" ? "Sample federation error" : null,
    refetch: () => emit(),
  };
}

export async function api<T>(
  path: string,
  method = "GET",
  _body?: unknown,
): Promise<T> {
  noteAction(`${method} ${path}`);
  if (path.endsWith("/nodes/probe"))
    return {
      node_uid: "crate:probe-04",
      display_name: "Probed Sample Node",
      api_base_url: "https://probe.crate.example",
    } as T;
  if (path.endsWith("/pairing/start"))
    return { pairing_code: "CRATE-REVIEW", expires_in: 600 } as T;
  return { ok: true, success: true } as T;
}
