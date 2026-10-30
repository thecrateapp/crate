import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PlaySource, Track } from "./player-types";
import type {
  EngineAppendedTrack,
  EngineEventMap,
  EngineEventName,
  EngineState,
} from "@/lib/playback-engine";

const native = vi.hoisted(() => ({
  hasBackgroundContinuation: vi.fn(() => true),
  getState: vi.fn<() => Promise<EngineState | null>>(),
  drainEvents: vi.fn().mockResolvedValue([]),
  takeAppendedTracks: vi.fn<() => Promise<EngineAppendedTrack[]>>(),
  getContinuationCursor: vi.fn(),
  isCurrentQueueRevision: () => true,
  planAhead: vi.fn(),
}));
const listeners = new Map<EngineEventName, (event: unknown) => void>();

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => true,
  androidNativeEngine: {
    ...native,
    on: async <K extends EngineEventName>(
      event: K,
      listener: (payload: EngineEventMap[K]) => void,
    ) => {
      listeners.set(event, listener as (event: unknown) => void);
      return () => listeners.delete(event);
    },
  },
}));
vi.mock("@/lib/gapless-player", () => ({ initPlayer: () => ({}) }));
vi.mock("@/lib/cast-sender", () => ({ isCastSessionActive: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/radio-continuation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/radio-continuation")>()),
  fetchContinuationBatch: vi.fn(),
}));

import {
  fetchContinuationBatch,
  type ContinuationBatch,
} from "@/lib/radio-continuation";
import { STORAGE_KEY } from "./player-utils";
import { useNativeContinuationAdoption } from "./use-native-continuation-adoption";
import { useNativePlaybackRuntime } from "./use-native-playback-runtime";
import { usePlaybackIntelligence } from "./use-playback-intelligence";
import { usePlayerRuntimeState } from "./use-player-runtime-state";

const a: Track = { id: "a", title: "A", artist: "Band" };
const b: Track = { id: "b", title: "B", artist: "Band" };
const flush = () => act(async () => {});
function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setup() {
  const source: PlaySource = {
    type: "album",
    name: "Album",
    radio: {
      seedType: "album",
      seedId: 42,
      continuationSessionId: "handoff-session",
      continuationBatchIndex: 1,
    },
  };
  let state!: ReturnType<typeof usePlayerRuntimeState>;
  const onUnavailable = vi.fn();
  const publishContinuationCursor = vi.fn().mockResolvedValue(undefined);
  const adoptTracks = vi.fn((tracks: Track[]) =>
    state.commitQueue([...state.queueRef.current, ...tracks]),
  );
  const appendTracks = vi.fn(
    async (tracks: Track[], isCurrent?: () => boolean) => {
      if (isCurrent && !isCurrent()) return 0;
      state.commitQueue([...state.queueRef.current, ...tracks]);
      return tracks.length;
    },
  );
  const appendAndAdvance = vi.fn(
    async (tracks: Track[], isCurrent?: () => boolean) => {
      if (isCurrent && !isCurrent()) return 0;
      const index = state.queueRef.current.length;
      state.commitQueue([...state.queueRef.current, ...tracks]);
      state.commitCurrentIndex(index);
      state.commitIsPlaying(true);
      state.commitIsBuffering(false);
      return tracks.length;
    },
  );
  const rendered = renderHook(() => {
    state = usePlayerRuntimeState();
    const adoptNativeAppendedTracks = useNativeContinuationAdoption({
      queueReadinessRef: state.queueReadinessRef,
      adoptTracks,
      queueRef: state.queueRef,
      playSourceRef: state.playSourceRef,
    });
    const intelligence = usePlaybackIntelligence({
      queueReadinessRef: state.queueReadinessRef,
      stateRefs: state,
      repeat: state.repeat,
      queue: state.queue,
      currentIndex: state.currentIndex,
      isPlaying: state.isPlaying,
      playSource: state.playSource,
      shuffle: state.shuffle,
      infinitePlaybackEnabled: true,
      smartPlaylistSuggestionsEnabled: false,
      smartPlaylistSuggestionsCadence: 3,
      recentlyPlayed: [],
      actions: {
        synchronizeContinuation: adoptNativeAppendedTracks,
        appendTracks,
        appendAndAdvance,
        setBuffering: state.commitIsBuffering,
        insertSuggestionAfterCurrent: vi.fn(),
        onUnavailable,
        publishContinuationCursor,
      },
    });
    useNativePlaybackRuntime({
      ...state,
      recoverAtEnd: intelligence.recoverAtEnd,
      resumePlaybackIntelligence: intelligence.resumePlaybackIntelligence,
      resetPlaybackIntelligence: intelligence.resetPlaybackIntelligence,
      adoptNativeAppendedTracks,
      beginSoftInterruption: vi.fn(),
      ensureTrackerSession: vi.fn(),
      flushCurrentPlayEvent: vi.fn(),
      recordProgress: vi.fn(),
      rememberActiveTrack: vi.fn(),
      rotateTrackerSession: vi.fn(),
    });
    return { state, intelligence };
  });
  act(() => rendered.result.current.state.setPlaySource(source));
  const startEof = async () => {
    await act(async () => {
      rendered.result.current.intelligence.resumePlaybackIntelligence();
      listeners.get("queueEnded")!({ revision: "queue-a" });
    });
    expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  };
  return {
    ...rendered,
    startEof,
    source,
    onUnavailable,
    publishContinuationCursor,
    appendTracks,
    appendAndAdvance,
    adoptTracks,
  };
}

const endedState: EngineState = {
  revision: "queue-a",
  playbackState: "ended",
  isPlaying: false,
  index: 0,
  positionMs: 180_000,
  durationMs: 180_000,
  queueSize: 1,
  crossfadeMs: 0,
  eqEnabled: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  visibility("visible");
  listeners.clear();
  localStorage.clear();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ queue: [a], currentIndex: 0 }),
  );
  native.hasBackgroundContinuation.mockReturnValue(true);
  native.getState.mockResolvedValue(endedState);
  native.takeAppendedTracks.mockResolvedValue([]);
  native.getContinuationCursor.mockReturnValue({
    sessionId: "handoff-session",
    batchIndex: 1,
  });
  vi.mocked(fetchContinuationBatch)
    .mockReset()
    .mockImplementationOnce(() => new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  listeners.clear();
  visibility("visible");
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("retires a web EOF wait after native adopts and plays the next track without a false notice or extra advance", async () => {
  const {
    result,
    startEof,
    onUnavailable,
    appendTracks,
    appendAndAdvance,
    adoptTracks,
  } = setup();
  await flush();
  await startEof();
  act(() => visibility("hidden"));
  expect(vi.mocked(fetchContinuationBatch).mock.calls[0]![2].aborted).toBe(
    true,
  );
  const entries: EngineAppendedTrack[] = ["b", "c", "d", "e", "f"].map(
    (id, index) => ({
      sequence: index + 1,
      id,
      entityUid: id,
      durationMs: 180_000,
      source: {
        track_entity_uid: id,
        track_id: index + 2,
        track_path: `/music/${id}.flac`,
        title: id.toUpperCase(),
        artist: "Band",
      },
    }),
  );
  native.takeAppendedTracks.mockResolvedValueOnce(entries);
  native.getContinuationCursor.mockReturnValue({
    sessionId: "handoff-session",
    batchIndex: 2,
  });
  const playing: EngineState = {
    ...endedState,
    playbackState: "playing",
    isPlaying: true,
    index: 1,
    positionMs: 1_000,
    queueSize: 6,
  };
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect.soft(onUnavailable).not.toHaveBeenCalled();
  let finishSnapshot!: (state: EngineState | null) => void;
  native.getState.mockClear().mockReturnValue(
    new Promise((resolve) => {
      finishSnapshot = resolve;
    }),
  );
  vi.mocked(fetchContinuationBatch).mockResolvedValue({
    tracks: [{ id: "g", title: "G", artist: "Band" }],
    status: "ok",
    batchIndex: 2,
  });
  await act(async () => visibility("visible"));
  expect(adoptTracks).toHaveBeenCalledOnce();
  expect(native.getState).toHaveBeenCalled();
  expect(result.current.state.currentIndexRef.current).toBe(0);
  expect(
    result.current.state.queueRef.current.map((track) => track.id),
  ).toEqual(["a", "b", "c", "d", "e", "f"]);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect.soft(onUnavailable).not.toHaveBeenCalled();
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(appendAndAdvance).not.toHaveBeenCalled();

  await act(async () => finishSnapshot(playing));

  expect(onUnavailable).not.toHaveBeenCalled();
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(appendAndAdvance).not.toHaveBeenCalled();
  expect(appendTracks).not.toHaveBeenCalled();
  expect(result.current.state.currentIndexRef.current).toBe(1);
  expect(result.current.state.isPlayingRef.current).toBe(true);
  expect(result.current.state.isBufferingRef.current).toBe(false);
});

it("keeps an unfulfilled native handoff recoverable at EOF when returning to the foreground", async () => {
  let finish!: (value: ContinuationBatch) => void;
  vi.mocked(fetchContinuationBatch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, startEof, onUnavailable, appendTracks, appendAndAdvance } =
    setup();
  await flush();
  await startEof();
  act(() => visibility("hidden"));
  expect(vi.mocked(fetchContinuationBatch).mock.calls[0]![2].aborted).toBe(
    true,
  );
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => visibility("visible"));

  expect(fetchContinuationBatch).toHaveBeenCalledTimes(2);
  expect(appendAndAdvance).not.toHaveBeenCalled();
  await act(async () => finish({ tracks: [b], status: "ok", batchIndex: 1 }));

  expect(appendAndAdvance).toHaveBeenCalledOnce();
  expect(appendTracks).not.toHaveBeenCalled();
  expect(result.current.state.currentIndexRef.current).toBe(1);
  expect(result.current.state.isPlayingRef.current).toBe(true);
  expect(result.current.state.isBufferingRef.current).toBe(false);
  expect(onUnavailable).not.toHaveBeenCalled();
});

it.each(["paused", "buffering"] as const)(
  "preserves the native %s snapshot after handoff without autoplay or advancing another track",
  async (playbackState) => {
    const { result, startEof, onUnavailable, appendTracks, appendAndAdvance } =
      setup();
    await flush();
    await startEof();
    act(() => visibility("hidden"));
    expect(vi.mocked(fetchContinuationBatch).mock.calls[0]![2].aborted).toBe(
      true,
    );
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    const advanced = playbackState === "buffering";
    if (advanced) {
      native.takeAppendedTracks.mockResolvedValueOnce([
        {
          sequence: 1,
          id: "b",
          entityUid: "b",
          durationMs: 180_000,
          source: {
            track_entity_uid: "b",
            track_id: 2,
            track_path: "/music/b.flac",
            title: "B",
            artist: "Band",
          },
        },
      ]);
      native.getContinuationCursor.mockReturnValue({
        sessionId: "handoff-session",
        batchIndex: 2,
      });
    }
    const snapshot: EngineState = {
      ...endedState,
      playbackState,
      isPlaying: false,
      index: advanced ? 1 : 0,
      positionMs: advanced ? 2_000 : 42_000,
      queueSize: advanced ? 2 : 1,
    };
    native.getState.mockResolvedValue(snapshot);
    vi.mocked(fetchContinuationBatch)
      .mockImplementation(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        tracks: [{ id: "c", title: "C", artist: "Band" }],
        status: "ok",
        batchIndex: advanced ? 2 : 1,
      });

    await act(async () => visibility("visible"));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect.soft(fetchContinuationBatch).toHaveBeenCalledOnce();
    expect.soft(appendAndAdvance).not.toHaveBeenCalled();
    expect.soft(appendTracks).not.toHaveBeenCalled();
    expect.soft(result.current.state.isPlayingRef.current).toBe(false);
    expect
      .soft(result.current.state.currentIndexRef.current)
      .toBe(snapshot.index);
    expect(result.current.state.currentTimeRef.current).toBe(
      snapshot.positionMs / 1000,
    );
    expect(
      result.current.state.queueRef.current.map((track) => track.id),
    ).toEqual(advanced ? ["a", "b"] : ["a"]);
    expect(onUnavailable).not.toHaveBeenCalled();
  },
);

it("reconciles native ownership that becomes ready while hidden before releasing the pending web EOF request", async () => {
  let finishOldRequest!: (batch: ContinuationBatch) => void;
  vi.mocked(fetchContinuationBatch)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    );
  native.hasBackgroundContinuation.mockReturnValue(false);
  const { result, startEof, onUnavailable, appendTracks, appendAndAdvance } =
    setup();
  await flush();
  await startEof();
  const oldSignal = vi.mocked(fetchContinuationBatch).mock.calls[0]![2];
  act(() => visibility("hidden"));
  expect(oldSignal.aborted).toBe(false);
  native.hasBackgroundContinuation.mockReturnValue(true);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  native.takeAppendedTracks.mockResolvedValueOnce([
    {
      sequence: 1,
      id: "b",
      entityUid: "b",
      durationMs: 180_000,
      source: {
        track_entity_uid: "b",
        track_id: 2,
        track_path: "/music/b.flac",
        title: "B",
        artist: "Band",
      },
    },
  ]);
  native.getContinuationCursor.mockReturnValue({
    sessionId: "handoff-session",
    batchIndex: 2,
  });
  let finishSnapshot!: (snapshot: EngineState | null) => void;
  native.getState.mockClear().mockReturnValue(
    new Promise((resolve) => {
      finishSnapshot = resolve;
    }),
  );

  await act(async () => visibility("visible"));
  expect.soft(oldSignal.aborted).toBe(true);
  expect(native.getState).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(appendAndAdvance).not.toHaveBeenCalled();
  expect(result.current.state.currentIndexRef.current).toBe(0);
  await act(async () =>
    finishSnapshot({
      ...endedState,
      playbackState: "buffering",
      isPlaying: false,
      index: 1,
      positionMs: 2_000,
      queueSize: 2,
    }),
  );
  await act(async () =>
    finishOldRequest({
      tracks: [{ id: "c", title: "C", artist: "Band" }],
      status: "ok",
      batchIndex: 1,
    }),
  );

  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(appendAndAdvance).not.toHaveBeenCalled();
  expect(appendTracks).not.toHaveBeenCalled();
  expect(
    result.current.state.queueRef.current.map((track) => track.id),
  ).toEqual(["a", "b"]);
  expect(result.current.state.currentIndexRef.current).toBe(1);
  expect(result.current.state.currentTimeRef.current).toBe(2);
  expect(result.current.state.isPlayingRef.current).toBe(false);
  expect(onUnavailable).not.toHaveBeenCalled();
});

it("rejects a web EOF result that settles hidden after native ownership becomes ready without another visibility event", async () => {
  let finishOldRequest!: (batch: ContinuationBatch) => void;
  vi.mocked(fetchContinuationBatch)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    );
  native.hasBackgroundContinuation.mockReturnValue(false);
  const {
    result,
    source,
    startEof,
    onUnavailable,
    publishContinuationCursor,
    appendTracks,
    appendAndAdvance,
  } = setup();
  await flush();
  await startEof();
  const oldSignal = vi.mocked(fetchContinuationBatch).mock.calls[0]![2];
  act(() => visibility("hidden"));
  expect(oldSignal.aborted).toBe(false);
  native.hasBackgroundContinuation.mockReturnValue(true);

  await act(async () =>
    finishOldRequest({
      tracks: [{ id: "c", title: "C", artist: "Band" }],
      status: "ok",
      batchIndex: 1,
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(60_000));

  expect.soft(appendTracks).not.toHaveBeenCalled();
  expect.soft(appendAndAdvance).not.toHaveBeenCalled();
  expect.soft(publishContinuationCursor).not.toHaveBeenCalled();
  expect.soft(source.radio?.continuationBatchIndex).toBe(1);
  expect.soft(result.current.state.isPlayingRef.current).toBe(false);
  expect.soft(result.current.state.currentIndexRef.current).toBe(0);
  expect
    .soft(result.current.state.queueRef.current.map((track) => track.id))
    .toEqual(["a"]);
  expect.soft(onUnavailable).not.toHaveBeenCalled();
  native.takeAppendedTracks.mockResolvedValueOnce([
    {
      sequence: 1,
      id: "b",
      entityUid: "b",
      durationMs: 180_000,
      source: {
        track_entity_uid: "b",
        track_id: 2,
        track_path: "/music/b.flac",
        title: "B",
        artist: "Band",
      },
    },
  ]);
  native.getContinuationCursor.mockReturnValue({
    sessionId: "handoff-session",
    batchIndex: 2,
  });
  let finishSnapshot!: (snapshot: EngineState | null) => void;
  native.getState.mockClear().mockReturnValue(
    new Promise((resolve) => {
      finishSnapshot = resolve;
    }),
  );
  await act(async () => visibility("visible"));
  expect(native.getState).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  await act(async () =>
    finishSnapshot({
      ...endedState,
      playbackState: "buffering",
      isPlaying: false,
      index: 1,
      positionMs: 2_000,
      queueSize: 2,
    }),
  );

  expect(appendTracks).not.toHaveBeenCalled();
  expect(appendAndAdvance).not.toHaveBeenCalled();
  expect(publishContinuationCursor).not.toHaveBeenCalled();
  expect(
    result.current.state.queueRef.current.map((track) => track.id),
  ).toEqual(["a", "b"]);
  expect(result.current.state.currentIndexRef.current).toBe(1);
  expect(result.current.state.currentTimeRef.current).toBe(2);
  expect(result.current.state.isPlayingRef.current).toBe(false);
  expect(onUnavailable).not.toHaveBeenCalled();
});
