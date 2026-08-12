import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

const { getTracksMock, loadQueueMock, pauseMock, toStartupEngineTracksMock } =
  vi.hoisted(() => ({
    getTracksMock: vi.fn(() => ["/stream/current", "/stream/previous"]),
    loadQueueMock: vi.fn(),
    pauseMock: vi.fn(),
    toStartupEngineTracksMock: vi.fn(),
  }));

vi.mock("@/contexts/player-engine-adapter", () => ({
  toStartupEngineTracks: toStartupEngineTracksMock,
}));

vi.mock("@/contexts/player-utils", () => ({
  getEffectiveCrossfadeSeconds: vi.fn(() => 0),
  getPredictableNextTrack: vi.fn(() => null),
  getStreamUrl: (track: Track) => `/stream/${track.id}`,
  getTrackCacheKey: (track: Track) => track.id,
  MAX_RECENT: 20,
  saveRecentlyPlayed: vi.fn(),
}));

vi.mock("@/lib/gapless-player", () => ({
  getCurrentTrackDuration: vi.fn(() => 0),
  getTrackIndex: vi.fn(() => 0),
  getTracks: getTracksMock,
  loadQueue: loadQueueMock,
  pause: pauseMock,
  play: vi.fn(),
  seekTo: vi.fn(),
  setCrossfadeDuration: vi.fn(),
  setLoop: vi.fn(),
  setSingleMode: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { stop: vi.fn() },
  isAndroidNativePlayerAvailable: vi.fn(() => false),
  shouldUseAndroidNativePlayer: vi.fn(() => false),
}));

vi.mock("@/lib/offline", () => ({
  primeOfflineRuntimeProfile: vi.fn(async () => undefined),
}));

vi.mock("@/lib/player-playback-prefs", () => ({
  getCrossfadeDurationPreference: vi.fn(() => 0),
}));

import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";

const CURRENT: Track = {
  id: "current",
  title: "Current",
  artist: "Artist",
};
const PREVIOUS: Track = {
  id: "previous",
  title: "Previous",
  artist: "Artist",
};
const NEW_TRACK: Track = {
  id: "new",
  title: "New track",
  artist: "Artist",
};

function createOptions() {
  const queueRef = { current: [CURRENT, PREVIOUS] };
  const currentIndexRef = { current: 0 };
  return {
    queueRef,
    currentIndexRef,
    currentTrackRef: { current: CURRENT },
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
    playSourceRef: { current: null },
    smartCrossfadeEnabledRef: { current: false },
    effectiveCrossfadeMsRef: { current: 0 },
    isPlayingRef: { current: false },
    durationRef: { current: 0 },
    bufferingIntentRef: { current: false },
    activatedTrackKeyRef: { current: null as string | null },
    engineTrackMapRef: { current: new Map() },
    setRecentlyPlayed: vi.fn(),
    commitQueue: vi.fn((queue: Track[]) => {
      queueRef.current = queue;
    }),
    commitCurrentIndex: vi.fn((index: number) => {
      currentIndexRef.current = index;
    }),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    buildEngineUrls: vi.fn(
      (tracks: Track[], resolvedUrls?: string[]) =>
        resolvedUrls ?? tracks.map((track) => `/stream/${track.id}`),
    ),
    clearPrevRestartLatch: vi.fn(),
    markSeekPosition: vi.fn(),
  };
}

describe("usePlayerEngineSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toStartupEngineTracksMock.mockImplementation(async (tracks: Track[]) =>
      tracks.map((track) => ({ url: `/stream/${track.id}` })),
    );
  });

  it("does not let a stale engine playlist remove tracks from an authoritative queue", async () => {
    const options = createOptions();
    const nextQueue = [CURRENT, PREVIOUS, NEW_TRACK];
    const { result } = renderHook(() => usePlayerEngineSync(options));

    result.current.pushToEngine(nextQueue, 0, { autoplay: false });

    await waitFor(() => expect(loadQueueMock).toHaveBeenCalledTimes(1));

    // A later engine callback may pull without passing the snapshot. It must
    // still not replace the authoritative React queue with the stale engine
    // playlist.
    result.current.pullFromEngine();

    expect(options.commitQueue).toHaveBeenLastCalledWith(nextQueue);
  });

  it("silences the web engine before rebuilding an actively playing Jam queue", async () => {
    const options = createOptions();
    options.isPlayingRef.current = true;
    const nextQueue = [CURRENT, NEW_TRACK];
    const { result } = renderHook(() => usePlayerEngineSync(options));

    result.current.pushToEngine(nextQueue, 0, {
      autoplay: true,
      positionMs: 42_000,
      preservePlayback: true,
    });

    await waitFor(() => expect(loadQueueMock).toHaveBeenCalledTimes(1));

    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.invocationCallOrder[0]).toBeLessThan(
      loadQueueMock.mock.invocationCallOrder[0]!,
    );
  });

  it("silences the web engine even when the room snapshot says paused", async () => {
    const options = createOptions();
    const nextQueue = [CURRENT, NEW_TRACK];
    const { result } = renderHook(() => usePlayerEngineSync(options));

    result.current.pushToEngine(nextQueue, 0, {
      autoplay: false,
      positionMs: 42_000,
      preservePlayback: true,
    });

    await waitFor(() => expect(loadQueueMock).toHaveBeenCalledTimes(1));

    expect(pauseMock).toHaveBeenCalledTimes(2);
    expect(pauseMock.mock.invocationCallOrder[0]).toBeLessThan(
      loadQueueMock.mock.invocationCallOrder[0]!,
    );
  });

  it("does not let an older async queue sync overwrite a newer one", async () => {
    const options = createOptions();
    let releaseFirst!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    toStartupEngineTracksMock
      .mockImplementationOnce(async () => {
        await firstLoad;
        return [{ url: "/stream/old" }];
      })
      .mockImplementationOnce(async (tracks: Track[]) =>
        tracks.map((track) => ({ url: `/stream/${track.id}` })),
      );
    const { result } = renderHook(() => usePlayerEngineSync(options));

    result.current.pushToEngine([CURRENT, NEW_TRACK], 0, {
      autoplay: false,
      positionMs: 2_000,
    });
    result.current.pushToEngine([CURRENT, PREVIOUS], 0, {
      autoplay: false,
      positionMs: 9_000,
    });

    await waitFor(() => expect(loadQueueMock).toHaveBeenCalledTimes(1));
    expect(loadQueueMock).toHaveBeenLastCalledWith(
      ["/stream/current", "/stream/previous"],
      0,
    );

    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadQueueMock).toHaveBeenCalledTimes(1);
  });
});
