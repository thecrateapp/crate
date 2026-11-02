import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiBase, ensureFreshAuthToken } = vi.hoisted(() => ({
  apiBase: { value: "" },
  ensureFreshAuthToken: vi.fn(async () => true),
}));

vi.mock("@/lib/api", () => ({
  AUTH_SESSION_REJECTED_EVENT: "crate:auth-session-rejected",
  apiUrl: (path: string) => `${apiBase.value}${path}`,
  ensureFreshAuthToken,
  getApiAuthHeaders: () => ({ "X-Crate-App": "listen" }),
  getApiBase: () => apiBase.value,
}));

vi.mock("@/contexts/auth-runtime", () => ({
  AUTH_RUNTIME_RESET_EVENT: "crate:auth-runtime-reset",
}));

vi.mock("@/lib/server-store", () => ({
  getCurrentServerId: () => null,
}));

import {
  __resetPlaybackQoeForTests,
  flushPlaybackQoe,
  installPlaybackQoeFlush,
  recordPlaybackQoe,
  shapePlaybackQoeEvent,
} from "@/lib/playback-qoe";

const base = {
  origin: "local",
  requestedPolicy: "balanced",
  effectivePolicy: "balanced",
} as const;

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string) as {
      schema_version: number;
      batch_id: string;
      events: Array<Record<string, unknown>>;
    },
  );
}

async function settle() {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

describe("playback QoE", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    apiBase.value = "";
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    __resetPlaybackQoeForTests();
  });

  afterEach(() => {
    __resetPlaybackQoeForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("allow-lists the telemetry shape and removes identifiers and network hints", () => {
    expect(
      shapePlaybackQoeEvent({
        event: "startup",
        origin: "remote",
        requestedPolicy: "balanced",
        effectivePolicy: "data_saver",
        durationMs: 240,
        bufferedAheadSeconds: 2.5,
        trackId: "global-track-1",
        url: "https://peer.example/private-ticket",
        downlinkMbps: 0.5,
        rttMs: 900,
        runtime: "android_native",
        engine: "media3",
      }),
    ).toEqual({
      event: "startup",
      origin: "remote",
      requested_policy: "balanced",
      effective_policy: "data_saver",
      duration_ms: 240,
      buffered_ahead_seconds: 2.5,
      runtime: "android_native",
      engine: "media3",
    });
  });

  it("shapes results and active time the way the server validates them", () => {
    expect(shapePlaybackQoeEvent({ ...base, event: "result" })).toBeNull();
    expect(shapePlaybackQoeEvent({ ...base, event: "active" })).toBeNull();
    expect(
      shapePlaybackQoeEvent({
        ...base,
        event: "result",
        outcome: "started",
        cause: "network",
      }),
    ).toEqual({
      event: "result",
      origin: "local",
      requested_policy: "balanced",
      effective_policy: "balanced",
      outcome: "started",
    });
    expect(
      shapePlaybackQoeEvent({
        ...base,
        event: "result",
        outcome: "failed",
        cause: "decode",
      }),
    ).toMatchObject({ outcome: "failed", cause: "decode" });
    expect(
      shapePlaybackQoeEvent({ ...base, event: "intent", outcome: "failed" }),
    ).not.toHaveProperty("outcome");
  });

  it("sends version 2 batches with fetch and keeps the session on a 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const location = window.location.href;

    recordPlaybackQoe({ ...base, event: "intent" });
    recordPlaybackQoe({ ...base, event: "result", outcome: "started" });
    flushPlaybackQoe();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/playback/qoe",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        keepalive: true,
      }),
    );
    const batch = sentBodies(fetchMock)[0]!;
    expect(batch.schema_version).toBe(2);
    expect(batch.events.map((event) => event.event)).toEqual([
      "intent",
      "result",
    ]);
    expect(batch.events.every((event) => typeof event.event_id === "string"))
      .toBe(true);
    expect(window.location.href).toBe(location);
    expect(ensureFreshAuthToken).not.toHaveBeenCalled();
  });

  it("honours Retry-After before resending a rate-limited batch", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
    );

    recordPlaybackQoe({ ...base, event: "stall_start" });
    flushPlaybackQoe();
    await settle();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = sentBodies(fetchMock);
    expect(second?.batch_id).toBe(first?.batch_id);
  });

  it("drops pending events when the account changes or signs out", async () => {
    const uninstall = installPlaybackQoeFlush();

    recordPlaybackQoe({ ...base, event: "stall_start" });
    window.dispatchEvent(new CustomEvent("crate:auth-runtime-reset"));
    await vi.advanceTimersByTimeAsync(5_000);
    recordPlaybackQoe({ ...base, event: "recovery", attempt: 1 });
    window.dispatchEvent(new CustomEvent("crate:auth-session-rejected"));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("hands the buffer to sendBeacon when the page is hidden", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const uninstall = installPlaybackQoeFlush();

    recordPlaybackQoe({ ...base, event: "stall_start" });
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/playback/qoe",
      expect.any(Blob),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    uninstall();
  });
});
