import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatsRange } from "@/components/stats/stats-types";

const apiMock = vi.hoisted(() => vi.fn());
const cacheHooks = vi.hoisted(() => ({
  listeners: [] as Array<(scope: string) => void>,
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cache")>();
  return {
    ...actual,
    onCacheInvalidation: (fn: (scope: string) => void) => {
      cacheHooks.listeners.push(fn);
      return () => {};
    },
  };
});

import {
  __resetStatsRangeCache,
  useStatsRange,
} from "@/components/stats/explorer/use-stats-range";

function payload(start: string, end: string): StatsRange {
  return {
    start,
    end,
    available: true,
    top_artists: [],
    top_albums: [],
    top_tracks: [],
    discoveries: [],
  };
}

function marked(name: string, available = true): StatsRange {
  return {
    ...payload(A.start, A.end),
    available,
    top_artists: [{ artist_name: name, minutes: 1, plays: 1, share: 1 }],
  };
}

const BASE = "/api/me/stats/range";
const A = { start: "2026-01-01", end: "2026-01-10" };
const B = { start: "2026-02-01", end: "2026-02-10" };

describe("useStatsRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
    __resetStatsRangeCache();
    localStorage.removeItem("crate-current-server");
    localStorage.removeItem("listen-auth-user-id");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid changes into one request", async () => {
    apiMock.mockResolvedValue(payload(B.start, B.end));
    const { result, rerender } = renderHook(
      ({ range }) => useStatsRange(BASE, range, 5),
      { initialProps: { range: A } },
    );
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ range: B });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]![0]).toBe(
      `${BASE}?start=${B.start}&end=${B.end}&limit=5`,
    );
    expect(apiMock.mock.calls[0]![1]).toBe("GET");
    expect(result.current.data?.start).toBe(B.start);
    expect(result.current.loading).toBe(false);
  });

  it("aborts the superseded request", async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(
      ({ range }) => useStatsRange(BASE, range, 5),
      { initialProps: { range: A } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const signal = (apiMock.mock.calls[0]![3] as { signal: AbortSignal })
      .signal;
    expect(signal.aborted).toBe(false);
    rerender({ range: B });
    expect(signal.aborted).toBe(true);
  });

  it("ignores a stale response that resolves after a newer stretch", async () => {
    let resolveA: (value: StatsRange) => void = () => {};
    apiMock.mockImplementationOnce(
      () => new Promise<StatsRange>((resolve) => (resolveA = resolve)),
    );
    apiMock.mockResolvedValueOnce(payload(B.start, B.end));
    const { result, rerender } = renderHook(
      ({ range }) => useStatsRange(BASE, range, 5),
      { initialProps: { range: A } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ range: B });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      resolveA(payload(A.start, A.end));
    });
    expect(result.current.data?.start).toBe(B.start);
  });

  it("serves a cached stretch without a request", async () => {
    apiMock.mockResolvedValue(payload(A.start, A.end));
    const first = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(first.result.current.data?.start).toBe(A.start);
    first.unmount();
    apiMock.mockClear();
    const second = renderHook(() => useStatsRange(BASE, A, 5));
    expect(second.result.current.data?.start).toBe(A.start);
    expect(second.result.current.loading).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("reports errors without throwing", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not report aborts as errors and idles without base or range", async () => {
    apiMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe(false);
    const idle = renderHook(() => useStatsRange(null, A, 5));
    expect(idle.result.current).toEqual({
      data: null,
      loading: false,
      error: false,
    });
    const idle2 = renderHook(() => useStatsRange(BASE, null, 5));
    expect(idle2.result.current.loading).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest entry beyond 32 cached stretches", async () => {
    apiMock.mockImplementation((url: string) =>
      Promise.resolve(payload(url, url)),
    );
    const { rerender } = renderHook(
      ({ limit }) => useStatsRange(BASE, A, limit),
      { initialProps: { limit: 1 } },
    );
    for (let limit = 1; limit <= 33; limit += 1) {
      rerender({ limit });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }
    apiMock.mockClear();
    const oldest = renderHook(() => useStatsRange(BASE, A, 1));
    expect(oldest.result.current.loading).toBe(true);
    const newest = renderHook(() => useStatsRange(BASE, A, 33));
    expect(newest.result.current.data).not.toBeNull();
  });

  it("does not share cached stretches across servers or users", async () => {
    apiMock.mockResolvedValue(payload(A.start, A.end));
    const first = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(first.result.current.data).not.toBeNull();
    first.unmount();
    expect(apiMock).toHaveBeenCalledTimes(1);

    localStorage.setItem("listen-auth-user-id", "user-b");
    const otherUser = renderHook(() => useStatsRange(BASE, A, 5));
    expect(otherUser.result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(2);
    otherUser.unmount();

    localStorage.setItem("crate-current-server", "server-b");
    const otherServer = renderHook(() => useStatsRange(BASE, A, 5));
    expect(otherServer.result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it("empties the cache on history invalidation and refetches", async () => {
    apiMock.mockResolvedValue(payload(A.start, A.end));
    const { result } = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.data).not.toBeNull();
    act(() => cacheHooks.listeners.forEach((fn) => fn("library")));
    expect(result.current.data).not.toBeNull();
    act(() => cacheHooks.listeners.forEach((fn) => fn("history")));
    expect(result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).not.toBeNull();
  });

  it("clears an error once the stretch is requested again", async () => {
    apiMock.mockRejectedValueOnce(new Error("boom"));
    apiMock.mockResolvedValue(payload(B.start, B.end));
    const { result, rerender } = renderHook(
      ({ range }) => useStatsRange(BASE, range, 5),
      { initialProps: { range: A } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe(true);
    rerender({ range: B });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    apiMock.mockReturnValueOnce(new Promise(() => {}));
    rerender({ range: A });
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(true);
  });

  it("shows a stretch that is still being prepared without caching it", async () => {
    apiMock.mockResolvedValueOnce(marked("Preparing", false));
    apiMock.mockResolvedValueOnce(marked("Ready"));
    const first = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(first.result.current.data?.available).toBe(false);
    expect(first.result.current.loading).toBe(false);
    first.unmount();

    // The backfill finishes: the next visit asks again instead of serving
    // "still being prepared" for the rest of the session.
    const second = renderHook(() => useStatsRange(BASE, A, 5));
    expect(second.result.current.data).toBeNull();
    expect(second.result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(second.result.current.data?.available).toBe(true);
    expect(second.result.current.data?.top_artists[0]?.artist_name).toBe(
      "Ready",
    );
  });

  it("does not cache a response that resolves after a history clear", async () => {
    let resolveStale: (value: StatsRange) => void = () => {};
    apiMock.mockImplementationOnce(
      () => new Promise<StatsRange>((resolve) => (resolveStale = resolve)),
    );
    apiMock.mockResolvedValueOnce(marked("Fresh"));
    const { result } = renderHook(() => useStatsRange(BASE, A, 5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(apiMock).toHaveBeenCalledTimes(1);

    // The play lands and clears the cache; the in-flight response resolves
    // before React gets to clean up the effect that requested it.
    await act(async () => {
      cacheHooks.listeners.forEach((fn) => fn("history"));
      resolveStale(marked("Stale"));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.data?.top_artists[0]?.artist_name).toBe("Fresh");
  });

  it("does not refetch for a new range object with the same dates", async () => {
    apiMock.mockResolvedValue(payload(A.start, A.end));
    const { rerender } = renderHook(
      ({ range }) => useStatsRange(BASE, range, 5),
      { initialProps: { range: { ...A } } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ range: { ...A } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
