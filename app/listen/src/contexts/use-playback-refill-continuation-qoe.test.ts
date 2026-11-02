import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaySource, Track } from "./player-types";

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/radio-continuation", () => ({
  fetchContinuationBatch: vi.fn(),
  acknowledgeContinuationBatch: vi.fn(),
}));
vi.mock("@/lib/playback-qoe", () => ({
  recordPlaybackQoe: vi.fn(),
  getPlaybackQoeRuntime: () => "desktop_web",
}));
import { ApiError } from "@/lib/api";
import { recordPlaybackQoe } from "@/lib/playback-qoe";
import {
  fetchContinuationBatch,
  type ContinuationBatch,
} from "@/lib/radio-continuation";
import { usePlaybackRefillRuntime } from "./use-playback-refill-runtime";

const fetchBatch = vi.mocked(fetchContinuationBatch);
const recorded = vi.mocked(recordPlaybackQoe);
const a: Track = { id: "a", title: "A", artist: "A" };
const b: Track = { id: "b", title: "B", artist: "B" };
const batch = (
  tracks = [b],
  status: ContinuationBatch["status"] = tracks.length
    ? "ok"
    : "retryable_empty",
): ContinuationBatch => ({ tracks, status, batchIndex: 1 });

function setup(type: PlaySource["type"] = "album") {
  const source: PlaySource = {
    type,
    name: "Source",
    radio: { seedType: "album", seedId: 42 },
  };
  const actions = {
    appendTracks: vi.fn().mockResolvedValue(1),
    appendAndAdvance: vi.fn().mockResolvedValue(1),
    setBuffering: vi.fn(),
    insertSuggestionAfterCurrent: vi.fn(),
    onUnavailable: vi.fn(),
  };
  const refs = {
    currentIndexRef: { current: 0 },
    queueRef: { current: [a] },
    playSourceRef: { current: source as PlaySource | null },
    recentlyPlayedRef: { current: [] },
    actionsRef: { current: actions },
  };
  const opts = {
    repeat: "off" as const,
    currentIndex: 0,
    infinitePlaybackEnabled: true,
    playSource: source,
    queue: refs.queueRef.current,
    refs,
    shuffle: false,
    isPlaying: true,
    isSoftInterrupted: () => false,
  };
  return { opts, actions };
}

function pending() {
  let resolve!: (value: ContinuationBatch) => void;
  let reject!: (error: unknown) => void;
  fetchBatch.mockImplementation(
    () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  return {
    resolve: (value: ContinuationBatch) => resolve(value),
    reject: (error: unknown) => reject(error),
  };
}

function continuations() {
  return recorded.mock.calls.map(([event]) => event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  fetchBatch.mockReset();
  recorded.mockReset();
  fetchBatch.mockResolvedValue(batch());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("continuation waits at the end of the queue", () => {
  it("records nothing when a prefetch arrives before the queue runs out", async () => {
    const { opts, actions } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    await act(async () => {});

    expect(actions.appendTracks).toHaveBeenCalledOnce();
    expect(recorded).not.toHaveBeenCalled();
  });

  it("records one recovered wait with its duration when the batch arrives", async () => {
    const request = pending();
    const { opts } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      result.current.continueInfinitePlayback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      request.resolve(batch());
    });

    expect(continuations()).toEqual([
      {
        event: "continuation",
        continuation: "recovered",
        surface: "infinite",
        durationMs: 3_000,
        runtime: "desktop_web",
      },
    ]);
  });

  it("counts a pause during the wait as cancelled, not as starvation", async () => {
    pending();
    const { opts } = setup("radio");
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      result.current.continueInfinitePlayback();
      result.current.reset();
    });
    act(() => result.current.reset());

    expect(continuations()).toEqual([
      expect.objectContaining({ continuation: "cancelled", surface: "radio" }),
    ]);
  });

  it("records an involuntary empty queue once when the wait deadline passes", async () => {
    fetchBatch.mockImplementation(() => new Promise(() => {}));
    const { opts, actions } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      result.current.continueInfinitePlayback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(actions.onUnavailable).toHaveBeenCalledOnce();
    expect(continuations()).toEqual([
      expect.objectContaining({
        continuation: "unavailable",
        durationMs: 60_000,
      }),
    ]);
  });

  it("tells real exhaustion apart from a rejected session", async () => {
    const exhausted = pending();
    const first = setup("radio");
    const one = renderHook(() => usePlaybackRefillRuntime(first.opts));
    act(() => {
      one.result.current.continueInfinitePlayback();
    });
    await act(async () => exhausted.resolve(batch([], "exhausted")));
    one.unmount();

    const rejected = pending();
    const second = setup("radio");
    const two = renderHook(() => usePlaybackRefillRuntime(second.opts));
    act(() => {
      two.result.current.continueInfinitePlayback();
    });
    await act(async () => rejected.reject(new ApiError(401, "expired")));

    expect(continuations().map((event) => event.continuation)).toEqual([
      "exhausted",
      "auth",
    ]);
  });

  it("keeps one wait across retries until the queue advances", async () => {
    fetchBatch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(batch([]))
      .mockResolvedValueOnce(batch());
    const { opts, actions } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      result.current.continueInfinitePlayback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
    expect(continuations()).toEqual([
      expect.objectContaining({ continuation: "recovered" }),
    ]);
  });
});
