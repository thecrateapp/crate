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
import {
  fetchContinuationBatch,
  acknowledgeContinuationBatch,
  type ContinuationBatch,
} from "@/lib/radio-continuation";
import { usePlaybackRefillRuntime } from "./use-playback-refill-runtime";

const fetchBatch = vi.mocked(fetchContinuationBatch);
const a: Track = { id: "a", title: "A", artist: "A" };
const b: Track = { id: "b", title: "B", artist: "B" };
const batch = (tracks = [b]): ContinuationBatch => ({
  tracks,
  status: tracks.length ? "ok" : "retryable_empty",
  batchIndex: 1,
  revision: 1,
});
function setup(playing = true) {
  const source: PlaySource = {
    type: "album",
    name: "Album",
    radio: { seedType: "album", seedId: 42 },
  };
  const actions = {
    appendTracks: vi.fn().mockResolvedValue(1),
    appendAndAdvance: vi.fn().mockResolvedValue(1),
    setBuffering: vi.fn(),
    insertSuggestionAfterCurrent: vi.fn(),
  };
  const refs = {
    currentIndexRef: { current: 0 },
    queueRef: { current: [a] },
    playSourceRef: { current: source as PlaySource | null },
    recentlyPlayedRef: { current: [] },
    actionsRef: { current: actions },
  };
  return {
    opts: {
      repeat: "off" as const,
      currentIndex: 0,
      infinitePlaybackEnabled: true,
      playSource: source,
      queue: refs.queueRef.current,
      refs,
      shuffle: false,
      isPlaying: playing,
    },
    actions,
    refs,
  };
}
const flush = async () => {
  await act(async () => {});
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  fetchBatch.mockReset();
  vi.mocked(acknowledgeContinuationBatch).mockReset();
  fetchBatch.mockResolvedValue(batch());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("shared refill lifecycle", () => {
  it("prefetches once and keeps playback on the current track", async () => {
    const { opts, actions } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    expect(fetchBatch).toHaveBeenCalledOnce();
    expect(actions.appendTracks).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "b", isAutoplayContinuation: true })],
      expect.any(Function),
    );
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
  });
  it("waits for an in-flight batch at EOF and advances when it arrives", async () => {
    let resolve!: (b: ContinuationBatch) => void;
    fetchBatch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { opts, actions } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      expect(result.current.continueInfinitePlayback()).toBe(true);
    });
    await act(async () => {
      resolve(batch());
    });
    expect(fetchBatch).toHaveBeenCalledOnce();
    expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
    expect(actions.appendTracks).not.toHaveBeenCalled();
  });
  it.each(["empty", "dedup", "error"])(
    "retries %s without progress ticks",
    async (kind) => {
      const { opts, actions } = setup();
      if (kind === "empty") fetchBatch.mockResolvedValueOnce(batch([]));
      if (kind === "dedup") actions.appendTracks.mockResolvedValueOnce(0);
      if (kind === "error")
        fetchBatch.mockRejectedValueOnce(new Error("network"));
      renderHook(() => usePlaybackRefillRuntime(opts));
      await flush();
      expect(fetchBatch).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchBatch).toHaveBeenCalledTimes(2);
    },
  );
  it("keeps the same index when HTTP fails, but consumes confirmed empty batches", async () => {
    fetchBatch.mockRejectedValueOnce(new Error("timeout"));
    const { opts } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
    fetchBatch.mockResolvedValueOnce(batch([]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(acknowledgeContinuationBatch).toHaveBeenCalledOnce();
  });
  it("a user pause aborts the request and prevents late append and resume", async () => {
    let resolve!: (b: ContinuationBatch) => void;
    fetchBatch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { opts, actions } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    act(() => {
      result.current.continueInfinitePlayback();
      result.current.reset();
    });
    await act(async () => {
      resolve(batch());
    });
    expect(fetchBatch.mock.calls[0]![2].aborted).toBe(true);
    expect(actions.appendTracks).not.toHaveBeenCalled();
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchBatch).toHaveBeenCalledOnce();
  });
  it("ignores a response belonging to another source", async () => {
    let resolve!: (b: ContinuationBatch) => void;
    fetchBatch.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { opts, actions, refs } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    refs.playSourceRef.current = { type: "queue", name: "Other queue" };
    await act(async () => {
      resolve(batch());
    });
    expect(actions.appendTracks).not.toHaveBeenCalled();
  });
  it("ends retries explicitly when the session expires", async () => {
    fetchBatch.mockResolvedValueOnce({ ...batch([]), status: "exhausted" });
    const { opts } = setup();
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    expect(result.current.continueInfinitePlayback()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchBatch).toHaveBeenCalledOnce();
  });
  it("does not prefetch while paused or in repeat mode", async () => {
    const { opts } = setup(false);
    const { rerender } = renderHook(
      ({ repeat }) => usePlaybackRefillRuntime({ ...opts, repeat }),
      { initialProps: { repeat: "off" as "off" | "one" | "all" } },
    );
    await flush();
    rerender({ repeat: "all" });
    await flush();
    expect(fetchBatch).not.toHaveBeenCalled();
  });
  it("releases a stalled request and schedules recovery at its deadline", async () => {
    fetchBatch.mockImplementationOnce(() => new Promise(() => {}));
    const { opts } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(fetchBatch.mock.calls[0]![2].aborted).toBe(true);
  });
  it("recovers on online without waiting for a track event", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const { opts } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    expect(fetchBatch).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchBatch).toHaveBeenCalledOnce();
  });
  it("cleans timers and ignores pending responses after unmount", async () => {
    fetchBatch.mockResolvedValue(batch([]));
    const { opts } = setup();
    const { unmount } = renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("a pending UI playing state cannot undo explicit cancellation on queue changes", async () => {
  const { opts } = setup();
  const { result, rerender } = renderHook(
    ({ queue }) => usePlaybackRefillRuntime({ ...opts, queue }),
    { initialProps: { queue: opts.queue } },
  );
  await flush();
  act(() => result.current.reset());
  rerender({ queue: [...opts.queue] });
  await flush();
  expect(fetchBatch).toHaveBeenCalledOnce();
  act(() => result.current.resume());
  await flush();
  expect(fetchBatch).toHaveBeenCalledTimes(2);
});

it("EOF during an asynchronous append advances from the confirmed buffer", async () => {
  const { opts, actions } = setup();
  let ack!: (count: number) => void;
  actions.appendTracks.mockImplementation(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
  await flush();
  act(() => {
    expect(result.current.recoverAtEnd()).toBe(true);
  });
  await act(async () => {
    ack(1);
  });
  expect(actions.appendAndAdvance).toHaveBeenCalledWith(
    [],
    expect.any(Function),
  );
});

it.each(["infinite", "repeat"])(
  "reenables %s during playback without restarting the track",
  async (kind) => {
    const { opts } = setup();
    const { rerender } = renderHook(
      ({ enabled }) =>
        usePlaybackRefillRuntime({
          ...opts,
          infinitePlaybackEnabled: kind === "infinite" ? enabled : true,
          repeat: kind === "repeat" && !enabled ? "all" : "off",
        }),
      { initialProps: { enabled: false } },
    );
    await flush();
    expect(fetchBatch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flush();
    expect(fetchBatch).toHaveBeenCalledOnce();
  },
);

it("remembers resume intent while Infinite is disabled", async () => {
  const { opts } = setup(false);
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      usePlaybackRefillRuntime({ ...opts, infinitePlaybackEnabled: enabled }),
    { initialProps: { enabled: false } },
  );
  act(() => result.current.reset());
  act(() => result.current.resume());
  expect(fetchBatch).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await flush();
  expect(fetchBatch).toHaveBeenCalledOnce();
});

it("waits for the prepared queue before fetching a new source with its actual buffer", async () => {
  const { opts, actions } = setup();
  const readiness = { current: { ready: false, generation: 1 } };
  const refs = { ...opts.refs, queueReadinessRef: readiness };
  const { result } = renderHook(() =>
    usePlaybackRefillRuntime({ ...opts, refs }),
  );
  await flush();
  expect(fetchBatch).not.toHaveBeenCalled();
  expect(actions.appendTracks).not.toHaveBeenCalled();
  act(() => {
    refs.queueRef.current = [b];
    readiness.current.ready = true;
    result.current.resume();
  });
  await flush();
  expect(fetchBatch).toHaveBeenCalledWith(
    opts.playSource,
    [b],
    expect.any(AbortSignal),
  );
});

it("rejects an older result once a replacement queue starts preparing", async () => {
  const { opts, actions } = setup();
  const readiness = { current: { ready: true, generation: 1 } };
  let resolve!: (batch: ContinuationBatch) => void;
  fetchBatch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const refs = { ...opts.refs, queueReadinessRef: readiness };
  renderHook(() => usePlaybackRefillRuntime({ ...opts, refs }));
  readiness.current = { ready: false, generation: 2 };
  await act(async () => {
    resolve(batch());
  });
  expect(actions.appendTracks).not.toHaveBeenCalled();
  expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
});

it("continues Infinite with shuffle while repeat retains priority", async () => {
  const { opts } = setup();
  const { rerender } = renderHook(
    ({ repeat }) =>
      usePlaybackRefillRuntime({
        ...opts,
        shuffle: true,
        repeat,
      }),
    { initialProps: { repeat: "all" as "all" | "off" } },
  );
  await flush();
  expect(fetchBatch).not.toHaveBeenCalled();
  rerender({ repeat: "off" });
  await flush();
  expect(fetchBatch).toHaveBeenCalledOnce();
});

it("publishes the acknowledged cursor after each foreground batch", async () => {
  const { opts, refs } = setup();
  const published: number[] = [];
  const actions = {
    ...refs.actionsRef.current,
    publishContinuationCursor: (source: PlaySource) => {
      published.push(source.radio!.continuationBatchIndex!);
    },
  };
  const nextRefs = { ...refs, actionsRef: { current: actions } };
  vi.mocked(acknowledgeContinuationBatch).mockImplementation(
    (source, batch) => {
      source.radio!.continuationBatchIndex = batch.batchIndex! + 1;
      source.radio!.continuationRevision = batch.revision;
    },
  );
  fetchBatch
    .mockResolvedValueOnce({ ...batch(), batchIndex: 0 })
    .mockResolvedValueOnce({ ...batch(), batchIndex: 1 });
  const { result } = renderHook(() =>
    usePlaybackRefillRuntime({ ...opts, refs: nextRefs }),
  );
  await flush();
  expect(published).toEqual([1]);
  act(() => result.current.resume());
  await flush();
  expect(published).toEqual([1, 2]);
});

it("acknowledges an append confirmed after Pause without restarting playback", async () => {
  const { opts, actions, refs } = setup();
  let ack!: (count: number) => void;
  actions.appendTracks.mockImplementation(
    () =>
      new Promise((done) => {
        ack = done;
      }),
  );
  const publish = vi.fn();
  const nextRefs = {
    ...refs,
    actionsRef: { current: { ...actions, publishContinuationCursor: publish } },
  };
  const { result } = renderHook(() =>
    usePlaybackRefillRuntime({ ...opts, refs: nextRefs }),
  );
  await flush();
  act(() => result.current.reset());
  await act(async () => {
    ack(1);
  });
  expect(acknowledgeContinuationBatch).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(actions.appendAndAdvance).not.toHaveBeenCalled();
});

it("does not acknowledge an old queue's append after its source changed", async () => {
  const { opts, actions, refs } = setup();
  let ack!: (count: number) => void;
  actions.appendTracks.mockImplementation(
    () =>
      new Promise((done) => {
        ack = done;
      }),
  );
  const publish = vi.fn();
  const nextRefs = {
    ...refs,
    actionsRef: { current: { ...actions, publishContinuationCursor: publish } },
  };
  const { result } = renderHook(() =>
    usePlaybackRefillRuntime({ ...opts, refs: nextRefs }),
  );
  await flush();
  refs.playSourceRef.current = { type: "queue", name: "Other" };
  act(() => result.current.reset());
  await act(async () => {
    ack(1);
  });
  expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("does not retry the fetch while a valid batch waits for its append ACK", async () => {
  const { opts, actions } = setup();
  let ack!: (count: number) => void;
  actions.appendTracks.mockImplementation(
    () =>
      new Promise((done) => {
        ack = done;
      }),
  );
  renderHook(() => usePlaybackRefillRuntime(opts));
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetchBatch).toHaveBeenCalledOnce();
  await act(async () => {
    ack(1);
  });
  expect(acknowledgeContinuationBatch).toHaveBeenCalledOnce();
});
