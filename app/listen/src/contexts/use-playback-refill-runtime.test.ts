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
});
function setup(playing = true) {
  const interruption = { current: false };
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
      isSoftInterrupted: () => interruption.current,
    },
    actions,
    refs,
    interruption,
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
  it("does not fetch while stream recovery has soft-interrupted playback", async () => {
    const { opts, actions, interruption } = setup();
    interruption.current = true;
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));

    await flush();
    act(() => result.current.resume());
    await flush();

    expect(fetchBatch).not.toHaveBeenCalled();
    expect(actions.appendTracks).not.toHaveBeenCalled();
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
  });

  it("keeps refill suspended after recovery gives up and waits for a user gesture", async () => {
    const { opts, refs, interruption } = setup();
    const initialQueue = [a, b, a, b, a];
    refs.queueRef.current = initialQueue;
    const { rerender } = renderHook(
      ({ queue, isPlaying }) =>
        usePlaybackRefillRuntime({ ...opts, queue, isPlaying }),
      { initialProps: { queue: initialQueue, isPlaying: true } },
    );
    await flush();
    expect(fetchBatch).not.toHaveBeenCalled();

    interruption.current = true;
    refs.queueRef.current = [a];
    rerender({ queue: refs.queueRef.current, isPlaying: false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("rechecks soft interruption after awaiting native queue synchronization", async () => {
    let synchronized!: () => void;
    const synchronizeContinuation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          synchronized = resolve;
        }),
    );
    const { opts, refs, interruption } = setup();
    const nextRefs = {
      ...refs,
      actionsRef: {
        current: { ...refs.actionsRef.current, synchronizeContinuation },
      },
    };
    renderHook(() => usePlaybackRefillRuntime({ ...opts, refs: nextRefs }));
    expect(synchronizeContinuation).toHaveBeenCalledOnce();
    interruption.current = true;

    await act(async () => synchronized());

    expect(fetchBatch).not.toHaveBeenCalled();
  });

  it("rejects a batch when playback becomes soft-interrupted while HTTP is pending", async () => {
    let resolve!: (value: ContinuationBatch) => void;
    fetchBatch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { opts, actions, interruption } = setup();
    renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    interruption.current = true;

    await act(async () => resolve(batch()));

    expect(actions.appendTracks).not.toHaveBeenCalled();
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
    expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
  });

  it("invalidates the append guard when soft interruption starts before its ACK", async () => {
    let finishAppend!: () => void;
    let appendGuard!: () => boolean;
    const committed: Track[] = [];
    const { opts, actions, interruption } = setup();
    actions.appendTracks.mockImplementation(
      (tracks: Track[], isCurrent: () => boolean) =>
        new Promise<number>((resolve) => {
          appendGuard = isCurrent;
          finishAppend = () => {
            if (isCurrent()) {
              committed.push(...tracks);
              resolve(tracks.length);
            } else resolve(0);
          };
        }),
    );
    renderHook(() => usePlaybackRefillRuntime(opts));
    await flush();
    interruption.current = true;
    const mayAppendDuringRecovery = appendGuard();

    await act(async () => finishAppend());

    expect(mayAppendDuringRecovery).toBe(false);
    expect(committed).toEqual([]);
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
    expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
  });

  it("does not take EOF ownership while a stream interruption waits for recovery", async () => {
    const { opts, actions, interruption } = setup();
    interruption.current = true;
    const { result } = renderHook(() => usePlaybackRefillRuntime(opts));
    let accepted = true;

    act(() => {
      accepted = result.current.recoverAtEnd();
    });
    await flush();

    expect(accepted).toBe(false);
    expect(actions.setBuffering).not.toHaveBeenCalledWith(true);
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
  });

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
  it("recovers on online at the retry deadline without waiting for a track event", async () => {
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
    expect(fetchBatch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
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

describe("refill handoff after stream recovery", () => {
  function setupHandoff() {
    let finishOldRequest!: (value: ContinuationBatch) => void;
    fetchBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    );
    const { opts, refs, actions, interruption } = setup();
    const queueReadinessRef = { current: { ready: true, generation: 1 } };
    const nextRefs = { ...refs, queueReadinessRef };
    const { result } = renderHook(() =>
      usePlaybackRefillRuntime({ ...opts, refs: nextRefs }),
    );
    const finishRecovery = () => {
      interruption.current = true;
      queueReadinessRef.current = { ready: false, generation: 2 };
      interruption.current = false;
      queueReadinessRef.current.ready = true;
      result.current.resume();
      expect(result.current.recoverAtEnd()).toBe(true);
    };
    return {
      result,
      refs: nextRefs,
      actions,
      interruption,
      finishOldRequest,
      finishRecovery,
    };
  }

  it("wakes EOF refill after the previous generation's HTTP request finishes without another event", async () => {
    const { refs, actions, finishOldRequest, finishRecovery } = setupHandoff();
    const stale: Track = { id: "stale", title: "Stale", artist: "Artist" };
    actions.appendAndAdvance.mockImplementation(
      async (tracks: Track[], isCurrent: () => boolean) => {
        if (!isCurrent()) return 0;
        refs.queueRef.current = [...refs.queueRef.current, ...tracks];
        refs.currentIndexRef.current++;
        actions.setBuffering(false);
        return tracks.length;
      },
    );
    act(finishRecovery);
    expect(fetchBatch).toHaveBeenCalledOnce();

    await act(async () => {
      finishOldRequest(batch([stale]));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(refs.queueRef.current.map((track) => track.id)).toEqual(["a", "b"]);
    expect(refs.currentIndexRef.current).toBe(1);
    expect(actions.appendTracks).not.toHaveBeenCalled();
    expect(actions.appendAndAdvance).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "b" })],
      expect.any(Function),
    );
    expect(acknowledgeContinuationBatch).toHaveBeenCalledOnce();
    expect(actions.setBuffering).toHaveBeenLastCalledWith(false);
  });

  it.each(["soft interruption", "pause", "replacement source"])(
    "does not wake a discarded HTTP request after %s takes ownership",
    async (owner) => {
      const {
        result,
        refs,
        actions,
        interruption,
        finishOldRequest,
        finishRecovery,
      } = setupHandoff();
      act(finishRecovery);
      act(() => {
        if (owner === "soft interruption") interruption.current = true;
        if (owner === "pause") result.current.reset();
        if (owner === "replacement source") {
          refs.playSourceRef.current = {
            type: "album",
            name: "Replacement",
            radio: { seedType: "album", seedId: 99 },
          };
          refs.queueReadinessRef.current.generation++;
        }
      });

      await act(async () => finishOldRequest(batch()));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(fetchBatch).toHaveBeenCalledOnce();
      expect(actions.appendTracks).not.toHaveBeenCalled();
      expect(actions.appendAndAdvance).not.toHaveBeenCalled();
      expect(acknowledgeContinuationBatch).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing retry deadline when the discarded HTTP request finishes during backoff", async () => {
    const { actions, finishOldRequest, finishRecovery } = setupHandoff();
    act(finishRecovery);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500);
    });
    expect(fetchBatch).toHaveBeenCalledOnce();

    await act(async () => finishOldRequest(batch()));
    expect(fetchBatch).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(fetchBatch).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
  });
});

describe("bounded EOF refill", () => {
  it("keeps Resume consumed when its run settles the existing EOF synchronously", async () => {
    const harness = setup(false);
    fetchBatch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePlaybackRefillRuntime(harness.opts));
    act(() => {
      result.current.continueInfinitePlayback();
    });
    await flush();
    harness.refs.queueRef.current = [a, b];
    harness.refs.currentIndexRef.current = 1;
    let consumed: boolean | undefined;
    act(() => {
      consumed = result.current.resume();
    });
    expect(consumed).toBe(true);
  });

  it("resumes normal prefetch after a user selects another track following unavailability", async () => {
    const harness = setup(false);
    harness.refs.queueRef.current = [b, a];
    harness.refs.currentIndexRef.current = 1;
    harness.opts.queue = harness.refs.queueRef.current;
    fetchBatch.mockRejectedValue(new Error("offline transport"));
    const onUnavailable = vi.fn();
    Object.assign(harness.refs.actionsRef.current, { onUnavailable });
    const { result, rerender } = renderHook(
      ({ index, playing }) =>
        usePlaybackRefillRuntime({
          ...harness.opts,
          currentIndex: index,
          isPlaying: playing,
        }),
      { initialProps: { index: 1, playing: false } },
    );
    act(() => {
      result.current.continueInfinitePlayback();
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(onUnavailable).toHaveBeenCalledOnce();
    fetchBatch.mockResolvedValue(batch([{ ...b, id: "c" }]));
    harness.refs.currentIndexRef.current = 0;
    rerender({ index: 0, playing: true });
    act(() => {
      expect(result.current.resume({ userGesture: true })).toBe(false);
    });
    await flush();
    expect(harness.actions.appendTracks).toHaveBeenCalledOnce();
    expect(harness.actions.appendAndAdvance).not.toHaveBeenCalled();
  });

  const online = (value: boolean) =>
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value,
    });
  beforeEach(() => {
    online(true);
  });
  afterEach(() => {
    online(true);
  });

  function setupEof(playing = false) {
    const harness = setup(playing);
    const onUnavailable = vi.fn();
    const refs = {
      ...harness.refs,
      actionsRef: { current: { ...harness.actions, onUnavailable } },
    };
    const rendered = renderHook(
      ({ source }) =>
        usePlaybackRefillRuntime({ ...harness.opts, refs, playSource: source }),
      { initialProps: { source: harness.opts.playSource } },
    );
    const start = () => {
      expect(rendered.result.current.continueInfinitePlayback()).toBe(true);
    };
    const gesture = () => {
      const resume = rendered.result.current.resume as (options?: {
        userGesture?: boolean;
      }) => boolean | void;
      return resume({ userGesture: true });
    };
    return { ...harness, ...rendered, refs, onUnavailable, start, gesture };
  }

  async function setupPendingCursorPublish() {
    const { acknowledgeContinuationBatch: acknowledge } = await vi.importActual<
      typeof import("@/lib/radio-continuation")
    >("@/lib/radio-continuation");
    vi.mocked(acknowledgeContinuationBatch).mockImplementation(acknowledge);
    const harness = setup(false);
    const source = harness.opts.playSource;
    Object.assign(source.radio!, {
      continuationSessionId: "cursor-session",
      continuationBatchIndex: 1,
    });
    let finishPublish!: () => void;
    const publishContinuationCursor = vi
      .fn<(source: PlaySource, authoritative?: boolean) => Promise<void>>()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPublish = resolve;
          }),
      );
    const onUnavailable = vi.fn();
    const refs = {
      ...harness.refs,
      actionsRef: {
        current: {
          ...harness.actions,
          publishContinuationCursor,
          onUnavailable,
        },
      },
    };
    harness.actions.appendAndAdvance.mockImplementation(
      async (tracks: Track[], isCurrent: () => boolean) => {
        if (!isCurrent()) return 0;
        const nextIndex = refs.queueRef.current.length;
        refs.queueRef.current = [...refs.queueRef.current, ...tracks];
        refs.currentIndexRef.current = nextIndex;
        harness.actions.setBuffering(false);
        return tracks.length;
      },
    );
    fetchBatch.mockResolvedValueOnce(batch());
    const rendered = renderHook(() =>
      usePlaybackRefillRuntime({ ...harness.opts, refs }),
    );
    const start = () => {
      expect(rendered.result.current.continueInfinitePlayback()).toBe(true);
    };
    return {
      ...harness,
      ...rendered,
      refs,
      source,
      publishContinuationCursor,
      onUnavailable,
      finishPublish: () => finishPublish(),
      start,
    };
  }

  it("ends EOF waiting as soon as playback advances even when publishing its cursor is pending", async () => {
    const {
      result,
      refs,
      actions,
      onUnavailable,
      publishContinuationCursor,
      finishPublish,
      start,
      unmount,
    } = await setupPendingCursorPublish();
    try {
      act(start);
      await flush();
      expect(refs.queueRef.current.map((track) => track.id)).toEqual([
        "a",
        "b",
      ]);
      expect(refs.currentIndexRef.current).toBe(1);
      expect(actions.setBuffering).toHaveBeenLastCalledWith(false);
      expect(publishContinuationCursor).toHaveBeenCalledOnce();
      let consumed: boolean | void = undefined;
      act(() => {
        consumed = result.current.resume();
      });
      expect.soft(consumed).toBe(false);

      await act(async () => vi.advanceTimersByTimeAsync(60_000));

      expect(onUnavailable).not.toHaveBeenCalled();
      expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
    } finally {
      unmount();
      await act(async () => finishPublish());
    }
  });

  it("releases lost cursor bookkeeping within ten seconds so the next EOF fetches the next batch once", async () => {
    const {
      refs,
      source,
      actions,
      onUnavailable,
      publishContinuationCursor,
      finishPublish,
      start,
      unmount,
    } = await setupPendingCursorPublish();
    const next: Track = { id: "c", title: "C", artist: "C" };
    let finishBatch: ((value: ContinuationBatch) => void) | undefined;
    const requestedCursors: unknown[] = [];
    fetchBatch.mockImplementationOnce(
      (requestedSource) =>
        new Promise((resolve) => {
          requestedCursors.push({
            source: requestedSource,
            sessionId: requestedSource.radio?.continuationSessionId,
            batchIndex: requestedSource.radio?.continuationBatchIndex,
          });
          finishBatch = resolve;
        }),
    );
    try {
      act(start);
      await flush();
      expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
      expect(source.radio?.continuationBatchIndex).toBe(2);
      await act(async () => vi.advanceTimersByTimeAsync(9_999));
      act(start);
      await flush();
      expect(fetchBatch).toHaveBeenCalledOnce();
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(fetchBatch).toHaveBeenCalledTimes(2);
      expect(requestedCursors).toEqual([
        { source, sessionId: "cursor-session", batchIndex: 2 },
      ]);
      expect(fetchBatch.mock.calls[1]![0]).toBe(source);
      expect(fetchBatch.mock.calls[1]![1].map((track) => track.id)).toEqual([
        "b",
      ]);
      await act(async () => finishBatch!({ ...batch([next]), batchIndex: 2 }));
      expect(refs.queueRef.current.map((track) => track.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(refs.currentIndexRef.current).toBe(2);
      expect(source.radio).toMatchObject({
        continuationSessionId: "cursor-session",
        continuationBatchIndex: 3,
      });
      expect(acknowledgeContinuationBatch).toHaveBeenCalledTimes(2);
      expect(publishContinuationCursor).toHaveBeenCalledTimes(2);

      await act(async () => finishPublish());

      expect(actions.appendAndAdvance).toHaveBeenCalledTimes(2);
      expect(actions.appendTracks).not.toHaveBeenCalled();
      expect(fetchBatch).toHaveBeenCalledTimes(2);
      expect(source.radio).toMatchObject({
        continuationSessionId: "cursor-session",
        continuationBatchIndex: 3,
      });
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      unmount();
      await act(async () => {
        finishPublish();
        finishBatch?.({ ...batch([next]), batchIndex: 2 });
      });
    }
  });

  it.each(["transport", "offline"])(
    "ends EOF buffering after five %s failures and waits for a gesture without duplicate notices",
    async (failure) => {
      fetchBatch.mockRejectedValue(new Error("network unavailable"));
      if (failure === "offline") online(false);
      const { result, actions, onUnavailable, start } = setupEof();
      act(start);
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(onUnavailable).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(onUnavailable).toHaveBeenCalledOnce();
      expect(actions.setBuffering).toHaveBeenLastCalledWith(false);
      const attempts = fetchBatch.mock.calls.length;
      if (failure === "transport") expect(attempts).toBe(5);
      online(true);
      await act(async () => {
        result.current.resume();
        expect(result.current.continueInfinitePlayback()).toBe(false);
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(fetchBatch).toHaveBeenCalledTimes(attempts);
      expect(actions.appendAndAdvance).not.toHaveBeenCalled();
      expect(onUnavailable).toHaveBeenCalledOnce();
    },
  );

  it("bounds total EOF waiting at sixty seconds even when HTTP requests never settle", async () => {
    fetchBatch.mockImplementation(() => new Promise(() => {}));
    const { refs, actions, onUnavailable, start } = setupEof();
    const currentUnavailable = vi.fn();
    act(start);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    refs.actionsRef.current.onUnavailable = currentUnavailable;
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(currentUnavailable).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(currentUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(actions.setBuffering).toHaveBeenLastCalledWith(false);
    expect(
      fetchBatch.mock.calls[fetchBatch.mock.calls.length - 1]![2].aborted,
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a gesture retries an unavailable EOF attempt and advances only after a fresh batch arrives", async () => {
    fetchBatch.mockRejectedValue(new Error("server down"));
    const { refs, actions, onUnavailable, start, gesture } = setupEof();
    act(start);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(onUnavailable).toHaveBeenCalledOnce();
    let resolveBatch!: (value: ContinuationBatch) => void;
    fetchBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        }),
    );
    actions.appendAndAdvance.mockImplementation(
      async (tracks: Track[], isCurrent: () => boolean) => {
        if (!isCurrent()) return 0;
        refs.queueRef.current = [...refs.queueRef.current, ...tracks];
        refs.currentIndexRef.current = 1;
        actions.setBuffering(false);
        return tracks.length;
      },
    );
    let consumed: boolean | void = undefined;
    act(() => {
      consumed = gesture();
    });
    await flush();

    expect(consumed).toBe(true);
    expect(fetchBatch).toHaveBeenCalledTimes(6);
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
    expect(refs.currentIndexRef.current).toBe(0);
    await act(async () => resolveBatch(batch()));
    expect(refs.queueRef.current.map((track) => track.id)).toEqual(["a", "b"]);
    expect(refs.currentIndexRef.current).toBe(1);
    expect(actions.appendTracks).not.toHaveBeenCalled();
    expect(actions.setBuffering).toHaveBeenLastCalledWith(false);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("consumes Resume while EOF already waits for a batch without restarting the current track", async () => {
    let finish!: (value: ContinuationBatch) => void;
    fetchBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, actions, start } = setupEof();
    act(start);
    let consumed: boolean | void = undefined;
    act(() => {
      consumed = result.current.resume();
    });
    await act(async () => finish(batch()));

    expect(consumed).toBe(true);
    expect(fetchBatch).toHaveBeenCalledOnce();
    expect(actions.appendAndAdvance).toHaveBeenCalledOnce();
    expect(actions.appendTracks).not.toHaveBeenCalled();
  });

  it("does not stop a playing track or notify when only prefetch keeps failing", async () => {
    fetchBatch.mockRejectedValue(new Error("prefetch failed"));
    const { actions, onUnavailable } = setupEof(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(fetchBatch).toHaveBeenCalled();
    expect(actions.setBuffering).not.toHaveBeenCalled();
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it.each(["pause", "source", "dispose"])(
    "%s cancels the EOF deadline without notifying an obsolete attempt",
    async (change) => {
      let finish!: (value: ContinuationBatch) => void;
      fetchBatch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { result, refs, actions, onUnavailable, start, rerender, unmount } =
        setupEof();
      act(start);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      act(() => {
        if (change === "pause") result.current.reset();
        if (change === "dispose") unmount();
        if (change === "source") {
          const replacement: PlaySource = {
            type: "album",
            name: "Other",
            radio: { seedType: "album", seedId: 99 },
          };
          refs.playSourceRef.current = replacement;
          rerender({ source: replacement });
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
        finish(batch());
      });

      expect(onUnavailable).not.toHaveBeenCalled();
      expect(actions.appendTracks).not.toHaveBeenCalled();
      expect(actions.appendAndAdvance).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["exhausted", "auth_required"] as const)(
    "keeps %s terminal instead of treating it as a retryable transport limit",
    async (status) => {
      fetchBatch.mockResolvedValue({ ...batch([]), status });
      const { result, onUnavailable, start, gesture } = setupEof();
      act(start);
      await flush();
      await act(async () => {
        gesture();
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(result.current.recoverAtEnd()).toBe(false);
      expect(fetchBatch).toHaveBeenCalledOnce();
      expect(onUnavailable).not.toHaveBeenCalled();
    },
  );

  it.each(["visibilitychange", "online"])(
    "%s cannot advance the retry deadline",
    async (event) => {
      fetchBatch.mockRejectedValueOnce(
        new Error("temporary transport failure"),
      );
      setupEof(true);
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
        (event === "online" ? window : document).dispatchEvent(
          new Event(event),
        );
      });

      expect(fetchBatch).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(fetchBatch).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchBatch).toHaveBeenCalledTimes(2);
    },
  );
});
