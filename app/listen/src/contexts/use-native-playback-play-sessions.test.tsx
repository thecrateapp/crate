import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNativePlaybackReconciliation } from "./use-native-playback-reconciliation";
import type { EnginePositionEvent, EngineState } from "@/lib/playback-engine";

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { isCurrentQueueRevision: () => true },
}));

const A = { id: "a", title: "A", artist: "Band" };
const B = { id: "b", title: "B", artist: "Band" };
let sequence = 0;

function params() {
  return {
    clearNativeBufferingRecovery: vi.fn(),
    clearNativeBufferingWatchdog: vi.fn(),
    commitCurrentIndex: vi.fn(),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitIsPlaying: vi.fn(),
    currentIndexRef: { current: 0 },
    currentTrackRef: { current: A },
    ensureTrackerSession: vi.fn(),
    playSourceRef: { current: null },
    queueRef: { current: [A, B] },
    recordProgress: vi.fn(),
    rememberActiveTrack: vi.fn(),
    repeatRef: { current: "off" as "off" | "one" | "all" },
    rotateTrackerSession: vi.fn(),
    scheduleNativeBufferingWatchdog: vi.fn(),
  };
}

function trackChange(
  index: number,
  reason: string,
): EnginePositionEvent & { reason: string } {
  sequence += 1;
  return {
    revision: "queue-a",
    nativeSequence: sequence,
    index,
    positionMs: 0,
    durationMs: 200_000,
    isPlaying: true,
    reason,
  };
}

function render(options = params()) {
  const { result } = renderHook(() => useNativePlaybackReconciliation(options));
  return { options, result };
}

describe("native play sessions", () => {
  it("ends the outgoing play when native replaces the item without JS", () => {
    const { options, result } = render();

    act(() =>
      result.current.applyNativeTrackChange(trackChange(1, "playlist")),
    );

    expect(options.rotateTrackerSession).toHaveBeenCalledWith(
      "completed",
      A,
      B,
      null,
    );
    expect(options.ensureTrackerSession).toHaveBeenCalledWith(B, null);
  });

  it("ends the play native moved past when the next track is not in the JS queue yet", () => {
    const { options, result } = render();
    options.currentIndexRef.current = 1;

    act(() => result.current.applyNativeTrackChange(trackChange(2, "auto")));

    expect(options.rotateTrackerSession).toHaveBeenCalledWith(
      "completed",
      B,
      undefined,
      null,
    );
    expect(options.commitCurrentIndex).not.toHaveBeenCalled();
  });

  it("closes each repetition of a repeated track as its own play", () => {
    const { options, result } = render();

    act(() => result.current.applyNativeTrackChange(trackChange(0, "repeat")));

    expect(options.rotateTrackerSession).toHaveBeenCalledWith(
      "completed",
      A,
      A,
      null,
    );
  });

  it("follows an index change reported only by a state snapshot", () => {
    const { options, result } = render();
    sequence += 1;
    const state: EngineState = {
      revision: "queue-a",
      nativeSequence: sequence,
      playbackState: "playing",
      isPlaying: true,
      index: 1,
      positionMs: 4000,
      durationMs: 200_000,
      queueSize: 2,
      crossfadeMs: 0,
      eqEnabled: false,
    };

    act(() => result.current.applyNativeState(state));

    expect(options.rotateTrackerSession).toHaveBeenCalledWith(
      "completed",
      A,
      B,
      null,
    );
  });

  it("counts the position native observed for drained checkpoints", () => {
    const { options, result } = render();
    sequence += 1;

    act(() =>
      result.current.applyNativePosition({
        revision: "queue-a",
        nativeSequence: sequence,
        nativeTimeMs: Date.now() - 600_000,
        index: 0,
        positionMs: 45_800,
        durationMs: 200_000,
        isPlaying: true,
        checkpointMs: 5000,
      }),
    );

    expect(options.recordProgress).toHaveBeenCalledWith(45.8, 6.5);
  });
});
