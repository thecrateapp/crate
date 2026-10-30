import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaySource, Track } from "./player-types";
import type { EngineTrack } from "@/lib/playback-engine";

const engine = vi.hoisted(() => ({
  urls: [] as string[],
  index: 0,
  positionMs: 0,
  loadQueue: vi.fn(),
  play: vi.fn(),
}));

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
  androidNativeEngine: {},
}));
vi.mock("@/contexts/player-engine-adapter", () => ({
  toFreshEngineTrack: vi.fn(),
  toStartupEngineQueueSnapshot: vi.fn(),
  toStartupEngineTracks: vi.fn(),
}));
vi.mock("@/lib/gapless-player", () => ({
  getTrackIndex: () => engine.index,
  getTracks: () => engine.urls,
  loadQueue: engine.loadQueue,
  play: engine.play,
  replaceTrack: vi.fn(),
  seekTo: (positionMs: number) => {
    engine.positionMs = positionMs;
  },
}));
vi.mock("@/lib/radio-continuation", () => ({
  fetchContinuationBatch: vi.fn(),
  acknowledgeContinuationBatch: vi.fn(),
}));

import { toStartupEngineTracks } from "./player-engine-adapter";
import {
  acknowledgeContinuationBatch,
  fetchContinuationBatch,
  type ContinuationBatch,
} from "@/lib/radio-continuation";
import {
  buildTrackResolutionKey,
  usePlayerTrackRecovery,
} from "./use-player-track-recovery";
import { usePlaybackRefillRuntime } from "./use-playback-refill-runtime";

const track = (id: string): Track => ({ id, title: id, artist: "Artist" });
const a = track("a");
const b = track("b");
const c = track("c");
const resolvedTrack = (entry: Track): EngineTrack => ({
  id: entry.id,
  title: entry.title,
  artist: entry.artist,
  url: `/stream/${entry.id}?media_ticket=fresh-${entry.id}`,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(queue = [a, b], currentIndex = 0) {
  const source: PlaySource = {
    type: "radio",
    name: "Radio",
    radio: { seedType: "track", seedId: 1 },
  };
  const queueRef = { current: queue };
  const currentIndexRef = { current: currentIndex };
  const queueReadinessRef = { current: { ready: true, generation: 4 } };
  const playSourceRef = { current: source as PlaySource | null };
  const engineTrackMap = new Map<string, Track>();
  engine.urls = queue.map((entry) => {
    const url = `/stream/${entry.id}?media_ticket=expired`;
    engineTrackMap.set(url, entry);
    return url;
  });
  engine.index = currentIndex;
  const options = {
    buildEngineUrls: vi.fn((tracks: Track[], urls?: string[]) =>
      tracks.map((entry, index) => {
        const url = urls?.[index] ?? `/stream/${entry.id}`;
        engineTrackMap.set(url, entry);
        return url;
      }),
    ),
    currentIndexRef,
    currentTimeRef: { current: 12 },
    effectiveCrossfadeMsRef: { current: 0 },
    lastNonZeroVolumeRef: { current: 0.8 },
    playSourceRef,
    queueReadinessRef,
    queueRef,
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
  };
  const engineTrackIds = () =>
    engine.urls.map((url) => engineTrackMap.get(url)?.id);
  const currentEngineTrackId = () => engineTrackIds()[engine.index];
  return { options, engineTrackIds, currentEngineTrackId };
}

beforeEach(() => {
  vi.clearAllMocks();
  engine.urls = [];
  engine.index = 0;
  engine.positionMs = 0;
  engine.loadQueue.mockImplementation((urls: string[], index: number) => {
    engine.urls = [...urls];
    engine.index = index;
  });
  engine.play.mockResolvedValue(undefined);
  vi.mocked(toStartupEngineTracks).mockReset();
  vi.mocked(toStartupEngineTracks).mockImplementation(async (tracks) =>
    tracks.map(resolvedTrack),
  );
  vi.mocked(fetchContinuationBatch).mockReset();
});

describe("web track recovery queue consistency", () => {
  it("invalidates the queue generation before awaiting fresh stream tickets", async () => {
    const pending = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options } = setup();
    let readinessWhenPlaying:
      | { ready: boolean; generation: number }
      | undefined;
    engine.play.mockImplementation(async () => {
      readinessWhenPlaying = { ...options.queueReadinessRef.current };
    });
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    const duringResolution = { ...options.queueReadinessRef.current };

    await act(async () => {
      pending.resolve([resolvedTrack(a), resolvedTrack(b)]);
      await recovery;
    });

    expect(duringResolution).toEqual({
      ready: false,
      generation: 5,
      resumePending: expect.any(Function),
    });
    expect(options.queueReadinessRef.current).toEqual({
      ready: true,
      generation: 5,
    });
    expect(readinessWhenPlaying).toEqual({ ready: true, generation: 5 });
  });

  it("reloads the latest queue when an already committed append arrives during ticket resolution", async () => {
    const pending = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options, engineTrackIds, currentEngineTrackId } = setup([a, b], 1);
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    options.queueRef.current = [a, b, c];

    await act(async () => {
      pending.resolve([resolvedTrack(a), resolvedTrack(b)]);
      expect(await recovery).toBe(true);
    });

    expect(engineTrackIds()).toEqual(
      options.queueRef.current.map((entry) => entry.id),
    );
    expect(engine.index).toBe(options.currentIndexRef.current);
    expect(currentEngineTrackId()).toBe("b");
    expect(engine.urls[engine.index]).toBe(resolvedTrack(b).url);
    expect(engine.positionMs).toBe(12_000);
  });

  it("keeps fresh URLs attached to track identity after the queue and index move", async () => {
    const pending = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options, engineTrackIds, currentEngineTrackId } = setup([a, b], 1);
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    options.queueRef.current = [c, a, b];
    options.currentIndexRef.current = 2;

    await act(async () => {
      pending.resolve([resolvedTrack(a), resolvedTrack(b)]);
      expect(await recovery).toBe(true);
    });

    expect(engineTrackIds()).toEqual(["c", "a", "b"]);
    expect(engine.index).toBe(2);
    expect(currentEngineTrackId()).toBe("b");
    expect(engine.urls[2]).toBe(resolvedTrack(b).url);
    expect(engine.urls[0]).not.toBe(resolvedTrack(a).url);
    expect(engine.urls[1]).not.toBe(resolvedTrack(b).url);
  });

  it("discards a pending recovery after another queue owns the generation", async () => {
    const pending = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options } = setup();
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    options.queueReadinessRef.current = {
      ready: false,
      generation: options.queueReadinessRef.current.generation + 1,
    };
    const replacementReadiness = { ...options.queueReadinessRef.current };
    options.queueRef.current = [c];
    options.currentIndexRef.current = 0;
    options.playSourceRef.current = { type: "queue", name: "Replacement" };
    engine.urls = ["/stream/c?media_ticket=replacement"];
    engine.index = 0;

    let recovered = true;
    await act(async () => {
      pending.resolve([resolvedTrack(a), resolvedTrack(b)]);
      recovered = await recovery;
    });

    expect(recovered).toBe(false);
    expect(engine.loadQueue).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.urls).toEqual(["/stream/c?media_ticket=replacement"]);
    expect(options.queueReadinessRef.current).toEqual(replacementReadiness);
  });

  it("restores readiness after fresh ticket resolution rejects for the current recovery owner", async () => {
    const pending = deferred<EngineTrack[]>();
    const error = new Error("Could not renew stream ticket");
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options } = setup();
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();

    await act(async () => {
      const rejection = expect(recovery).rejects.toThrow(error);
      pending.reject(error);
      await rejection;
    });

    expect(options.queueReadinessRef.current).toEqual({
      ready: true,
      generation: 5,
    });
    expect(engine.loadQueue).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("does not restore a replacement owner's readiness when an older ticket resolution rejects", async () => {
    const pending = deferred<EngineTrack[]>();
    const error = new Error("Old ticket request failed after replacement");
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options } = setup();
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    const recoveryReadiness = { ...options.queueReadinessRef.current };
    const replacementReadiness = { ready: false, generation: 7 };
    options.queueReadinessRef.current = replacementReadiness;
    options.queueRef.current = [c];
    options.currentIndexRef.current = 0;
    options.currentTimeRef.current = 43;
    options.playSourceRef.current = { type: "queue", name: "Replacement" };
    engine.urls = ["/stream/c?media_ticket=replacement"];
    engine.index = 0;
    engine.positionMs = 43_000;

    await act(async () => {
      const rejection = expect(recovery).rejects.toThrow(error);
      pending.reject(error);
      await rejection;
    });

    expect(options.queueReadinessRef.current).toBe(replacementReadiness);
    expect(options.queueReadinessRef.current).toEqual({
      ready: false,
      generation: 7,
    });
    expect(options.queueRef.current).toEqual([c]);
    expect(engine.urls).toEqual(["/stream/c?media_ticket=replacement"]);
    expect(engine.positionMs).toBe(43_000);
    expect(engine.loadQueue).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(recoveryReadiness).toEqual({
      ready: false,
      generation: 5,
      resumePending: expect.any(Function),
    });
  });

  it("discards recovery when the active track changes within the same source and queue", async () => {
    const pending = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(pending.promise);
    const { options, currentEngineTrackId } = setup([a, b]);
    const source = options.playSourceRef.current;
    const queue = options.queueRef.current;
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const recovery = result.current.recoverActiveTrackRef.current();
    options.currentIndexRef.current = 1;
    options.currentTimeRef.current = 83;
    engine.index = 1;
    engine.positionMs = 83_000;

    let recovered = true;
    await act(async () => {
      pending.resolve([resolvedTrack(a), resolvedTrack(b)]);
      recovered = await recovery;
    });

    expect(recovered).toBe(false);
    expect(options.playSourceRef.current).toBe(source);
    expect(options.queueRef.current).toBe(queue);
    expect(options.currentIndexRef.current).toBe(1);
    expect(currentEngineTrackId()).toBe("b");
    expect(engine.positionMs).toBe(83_000);
    expect(engine.loadQueue).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(options.queueReadinessRef.current).toEqual({
      ready: true,
      generation: 5,
    });
  });

  it("does not let an earlier recovery overwrite a newer recovery", async () => {
    const first = deferred<EngineTrack[]>();
    const second = deferred<EngineTrack[]>();
    vi.mocked(toStartupEngineTracks)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { options } = setup();
    const { result } = renderHook(() => usePlayerTrackRecovery(options));
    const earlierRecovery = result.current.recoverActiveTrackRef.current();
    const laterRecovery = result.current.recoverActiveTrackRef.current();

    await act(async () => {
      second.resolve([resolvedTrack(a), resolvedTrack(b)]);
      expect(await laterRecovery).toBe(true);
    });
    const latestGeneration = options.queueReadinessRef.current.generation;
    const staleTracks = [a, b].map((entry) => ({
      ...resolvedTrack(entry),
      url: `/stream/${entry.id}?media_ticket=stale-recovery`,
    }));
    let recovered = true;
    await act(async () => {
      first.resolve(staleTracks);
      recovered = await earlierRecovery;
    });

    expect(recovered).toBe(false);
    expect(engine.loadQueue).toHaveBeenCalledOnce();
    expect(engine.play).toHaveBeenCalledOnce();
    expect(engine.urls).toEqual([resolvedTrack(a).url, resolvedTrack(b).url]);
    expect(options.queueReadinessRef.current).toEqual({
      ready: true,
      generation: latestGeneration,
    });
  });

  it("keeps the shared engine and UI queue aligned when refill races stream recovery", async () => {
    const tickets = deferred<EngineTrack[]>();
    const refill = deferred<ContinuationBatch>();
    vi.mocked(toStartupEngineTracks).mockReturnValueOnce(tickets.promise);
    vi.mocked(fetchContinuationBatch).mockReturnValueOnce(refill.promise);
    const { options, engineTrackIds, currentEngineTrackId } = setup([a, b], 1);
    const interrupted = { current: false };
    const append = vi.fn(async (tracks: Track[], isCurrent?: () => boolean) => {
      if (isCurrent && !isCurrent()) return 0;
      options.queueRef.current = [...options.queueRef.current, ...tracks];
      engine.urls.push(...options.buildEngineUrls(tracks));
      return tracks.length;
    });
    const actions = {
      appendTracks: append,
      appendAndAdvance: vi.fn(),
      insertSuggestionAfterCurrent: vi.fn(),
      setBuffering: vi.fn(),
    };
    const refillOptions = {
      repeat: "off" as const,
      currentIndex: options.currentIndexRef.current,
      infinitePlaybackEnabled: true,
      playSource: options.playSourceRef.current,
      queue: options.queueRef.current,
      shuffle: false,
      isPlaying: true,
      isSoftInterrupted: () => interrupted.current,
      refs: {
        currentIndexRef: options.currentIndexRef,
        queueReadinessRef: options.queueReadinessRef,
        queueRef: options.queueRef,
        playSourceRef: options.playSourceRef,
        recentlyPlayedRef: { current: [] },
        actionsRef: { current: actions },
      },
    };
    const { result } = renderHook(() => {
      const recovery = usePlayerTrackRecovery(options);
      usePlaybackRefillRuntime(refillOptions);
      return recovery;
    });
    await act(async () => {});
    expect(fetchContinuationBatch).toHaveBeenCalledOnce();
    interrupted.current = true;
    const recovery = result.current.recoverActiveTrackRef.current();

    await act(async () => {
      refill.resolve({ tracks: [c], status: "ok", batchIndex: 1 });
    });
    await act(async () => {
      tickets.resolve([resolvedTrack(a), resolvedTrack(b)]);
      await recovery;
    });

    expect(engineTrackIds()).toEqual(
      options.queueRef.current.map((entry) => entry.id),
    );
    expect(engine.index).toBe(options.currentIndexRef.current);
    expect(currentEngineTrackId()).toBe("b");
    expect(append).not.toHaveBeenCalled();
    expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
  });
});

describe("buildTrackResolutionKey", () => {
  it("changes when any playback resolution input changes", () => {
    const base = buildTrackResolutionKey(
      "current",
      "next",
      2,
      3,
      "/stream/next-a",
    );

    expect(base).toBe("current:next:2:3:/stream/next-a");
    expect(
      buildTrackResolutionKey("current", "next", 2, 3, "/stream/next-b"),
    ).not.toBe(base);
    expect(
      buildTrackResolutionKey("current", "next", 2, 4, "/stream/next-a"),
    ).not.toBe(base);
  });
});
