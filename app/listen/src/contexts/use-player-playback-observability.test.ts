import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";
import { usePlayerPlaybackObservability } from "./use-player-playback-observability";

const {
  flushCurrentPlayEvent,
  markSeekPosition,
  recordProgress,
  rotateSession,
  ensureSession,
  startSession,
  recordPlaybackQoe,
  subscribeToPlaybackDeliveryNetworkChanges,
  installPlaybackQoeFlush,
} = vi.hoisted(() => ({
  flushCurrentPlayEvent: vi.fn(),
  markSeekPosition: vi.fn(),
  recordProgress: vi.fn(),
  rotateSession: vi.fn(),
  ensureSession: vi.fn(),
  startSession: vi.fn(),
  recordPlaybackQoe: vi.fn(),
  subscribeToPlaybackDeliveryNetworkChanges: vi.fn(() => vi.fn()),
  installPlaybackQoeFlush: vi.fn(() => vi.fn()),
}));

vi.mock("@/contexts/use-play-event-tracker", () => ({
  usePlayEventTracker: vi.fn(() => ({
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
    rotateSession,
    ensureSession,
    startSession,
  })),
}));

vi.mock("@/lib/playback-qoe", () => ({
  getPlaybackQoeRuntime: vi.fn(() => "desktop_web"),
  installPlaybackQoeFlush,
  recordPlaybackQoe,
}));

vi.mock("@/lib/player-playback-prefs", () => ({
  getEffectivePlaybackDeliveryPolicy: vi.fn(() => "balanced"),
  getPlaybackDeliveryPolicyPreference: vi.fn(() => "auto"),
  subscribeToPlaybackDeliveryNetworkChanges,
}));

vi.mock("@/lib/playback-provenance", () => ({
  getPlaybackDeliveryProvenance: vi.fn(() => null),
}));

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: vi.fn(() => false),
}));

const track: Track = {
  id: "track-1",
  title: "Track one",
  artist: "Artist one",
  origin: "local",
};

function createOptions() {
  return {
    currentTrackRef: { current: track },
    currentTimeRef: { current: 12 },
    durationRef: { current: 180 },
    playbackDeliveryPolicy: "auto" as const,
    setPlaybackDeliveryPolicy: vi.fn(),
  };
}

describe("usePlayerPlaybackObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes tracker callbacks and reports shaped QoE metadata", () => {
    const options = createOptions();
    const { result } = renderHook(() =>
      usePlayerPlaybackObservability(options),
    );

    expect(result.current.startTrackerSession).toBe(startSession);
    expect(result.current.ensureTrackerSession).toBe(ensureSession);
    expect(result.current.flushCurrentPlayEvent).toBe(flushCurrentPlayEvent);
    expect(result.current.markSeekPosition).toBe(markSeekPosition);
    expect(result.current.recordProgress).toBe(recordProgress);
    expect(subscribeToPlaybackDeliveryNetworkChanges).toHaveBeenCalledOnce();
    expect(installPlaybackQoeFlush).toHaveBeenCalledOnce();

    act(() => {
      result.current.recordCurrentPlaybackQoe("startup", { durationMs: 120 });
    });

    expect(recordPlaybackQoe).toHaveBeenCalledWith({
      event: "startup",
      origin: "local",
      requestedPolicy: "balanced",
      effectivePolicy: "balanced",
      runtime: "desktop_web",
      engine: "gapless",
      durationMs: 120,
    });
  });

  it("reports active listening time once a minute and the remainder on pagehide", () => {
    const { result } = renderHook(() =>
      usePlayerPlaybackObservability(createOptions()),
    );

    act(() => {
      for (let second = 0; second <= 70; second += 1) {
        result.current.recordPlaybackQualityProgress(second);
      }
      result.current.recordPlaybackQualityProgress(200);
      result.current.recordPlaybackQualityProgress(203);
    });

    const active = () =>
      recordPlaybackQoe.mock.calls
        .map(([input]) => input as { event: string; durationMs?: number })
        .filter((input) => input.event === "active");
    expect(active()).toEqual([
      expect.objectContaining({ event: "active", durationMs: 60_000 }),
    ]);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(active().map((input) => input.durationMs)).toEqual([60_000, 13_000]);
  });

  it("reports intents and results with the current track context", () => {
    const { result } = renderHook(() =>
      usePlayerPlaybackObservability(createOptions()),
    );

    act(() => {
      result.current.recordPlaybackIntent();
      result.current.recordPlaybackResult("failed", "network");
    });

    expect(recordPlaybackQoe).toHaveBeenCalledWith(
      expect.objectContaining({ event: "intent", origin: "local" }),
    );
    expect(recordPlaybackQoe).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "result",
        outcome: "failed",
        cause: "network",
      }),
    );
  });

  it("cleans up network and QoE listeners on unmount", () => {
    const networkCleanup = vi.fn();
    const qoeCleanup = vi.fn();
    subscribeToPlaybackDeliveryNetworkChanges.mockReturnValue(networkCleanup);
    installPlaybackQoeFlush.mockReturnValue(qoeCleanup);

    const { unmount } = renderHook(() =>
      usePlayerPlaybackObservability(createOptions()),
    );

    unmount();

    expect(networkCleanup).toHaveBeenCalledOnce();
    expect(qoeCleanup).toHaveBeenCalledOnce();
  });
});
