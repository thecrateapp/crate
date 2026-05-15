import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

import type { GaplessPlayerCallbacks } from "@/lib/gapless-player";
import type { PlaySource, Track } from "@/contexts/player-types";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";

vi.mock("@/contexts/player-utils", () => ({
  getStreamUrl: (track: Track) => `/stream/${track.id}`,
}));

vi.mock("@/lib/gapless-player", () => ({
  getCurrentTrackDuration: vi.fn(() => 0),
  isCurrentTrackFullyBuffered: vi.fn(() => false),
  isPlaybackGestureRequiredError: vi.fn(() => false),
  seekTo: vi.fn(),
}));

vi.mock("@/lib/capacitor", () => ({
  isOnline: vi.fn(() => Promise.resolve(true)),
}));

const TRACK_A: Track = { id: "a", title: "A", artist: "Artist" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Artist" };

function createOptions() {
  const callbacksRef = {
    current: {} as GaplessPlayerCallbacks,
  } as MutableRefObject<GaplessPlayerCallbacks>;
  return {
    callbacksRef,
    crossfadeTimerRef: { current: null } as MutableRefObject<number | null>,
    currentIndexRef: { current: 0 } as MutableRefObject<number>,
    currentTrackRef: { current: TRACK_A } as MutableRefObject<
      Track | undefined
    >,
    playSourceRef: { current: null } as MutableRefObject<PlaySource | null>,
    durationRef: { current: 0 } as MutableRefObject<number>,
    effectiveCrossfadeMsRef: { current: 0 } as MutableRefObject<number>,
    isPlayingRef: { current: true } as MutableRefObject<boolean>,
    bufferingIntentRef: { current: false } as MutableRefObject<boolean>,
    pendingRestoreTimeRef: { current: 0 } as MutableRefObject<number>,
    resumeAfterReloadRef: { current: false } as MutableRefObject<boolean>,
    engineTrackMapRef: { current: new Map() } as MutableRefObject<
      Map<string, Track[]>
    >,
    queueRef: { current: [TRACK_A, TRACK_B] } as MutableRefObject<Track[]>,
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    clearPrevRestartLatch: vi.fn(),
    clearStallTimer: vi.fn(),
    scheduleStallProtection: vi.fn(),
    cancelRestoreAutoplay: vi.fn(),
    tryRestoreAutoplay: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    requireUserGestureToResume: vi.fn(),
    beginSoftInterruption: vi.fn(),
    isSoftInterrupted: vi.fn(() => false),
    ensureTrackerSession: vi.fn(),
    rotateTrackerSession: vi.fn(),
    markSeekPosition: vi.fn(),
    recordProgress: vi.fn(),
    pullFromEngine: vi.fn(() => ({ resolvedTrack: TRACK_A })),
    setAnalyserVersion: vi.fn(),
    setCrossfadeTransition: vi.fn(),
  };
}

describe("usePlayerEngineCallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores buffering events from preload tracks", () => {
    const options = createOptions();
    renderHook(() => usePlayerEngineCallbacks(options));

    options.callbacksRef.current.onBuffering?.("/stream/b");

    expect(options.commitIsBuffering).not.toHaveBeenCalled();
    expect(options.scheduleStallProtection).not.toHaveBeenCalled();
  });

  it("arms stall protection without showing buffering while current audio is still playing", () => {
    const options = createOptions();
    renderHook(() => usePlayerEngineCallbacks(options));

    options.callbacksRef.current.onBuffering?.("/stream/a");

    expect(options.commitIsBuffering).not.toHaveBeenCalled();
    expect(options.scheduleStallProtection).toHaveBeenCalledTimes(1);
  });

  it("clears pending buffering intent once playback time advances", () => {
    const options = createOptions();
    options.bufferingIntentRef.current = true;
    renderHook(() => usePlayerEngineCallbacks(options));

    options.callbacksRef.current.onTimeUpdate?.(12_000, 0);

    expect(options.bufferingIntentRef.current).toBe(false);
    expect(options.commitIsBuffering).toHaveBeenCalledWith(false);
    expect(options.commitCurrentTime).toHaveBeenCalledWith(12);
  });
});
