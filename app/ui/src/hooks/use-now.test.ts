import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("returns the current time and refreshes it on every interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-19T12:00:00Z"));
    const { result } = renderHook(() => useNow(15_000));
    expect(result.current).toBe(Date.parse("2026-10-19T12:00:00Z"));

    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    expect(result.current).toBe(Date.parse("2026-10-19T12:00:00Z"));

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(Date.parse("2026-10-19T12:00:15Z"));
  });

  it("stops its timer on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useNow(1_000));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
