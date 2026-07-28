import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
  getApiBase: () => "https://listen.example",
}));

import {
  __resetPlaybackQoeForTests,
  flushPlaybackQoe,
  recordPlaybackQoe,
  shapePlaybackQoeEvent,
} from "@/lib/playback-qoe";

describe("playback QoE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetchMock
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 204 }));
    __resetPlaybackQoeForTests();
  });

  afterEach(() => {
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

  it("batches best-effort events without blocking the caller", async () => {
    recordPlaybackQoe({
      event: "stall_start",
      origin: "local",
      requestedPolicy: "original",
      effectivePolicy: "original",
    });
    recordPlaybackQoe({
      event: "recovery",
      origin: "local",
      requestedPolicy: "original",
      effectivePolicy: "original",
      attempt: 2,
    });

    flushPlaybackQoe();
    await Promise.resolve();

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/playback/qoe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              event: "stall_start",
              origin: "local",
              requested_policy: "original",
              effective_policy: "original",
            },
            {
              event: "recovery",
              origin: "local",
              requested_policy: "original",
              effective_policy: "original",
              attempt: 2,
            },
          ],
        }),
      }),
    );
  });

  it("caps repeated telemetry within one playback session", () => {
    for (let index = 0; index < 30; index += 1) {
      recordPlaybackQoe({
        event: "stall_start",
        origin: "local",
        requestedPolicy: "balanced",
        effectivePolicy: "balanced",
      });
    }

    flushPlaybackQoe();

    const allEvents = apiFetchMock.mock.calls.flatMap(([, init]) => {
      const body = JSON.parse(init?.body as string) as { events: unknown[] };
      return body.events;
    });
    expect(allEvents).toHaveLength(24);
    expect(apiFetchMock.mock.calls).toHaveLength(2);
  });
});
