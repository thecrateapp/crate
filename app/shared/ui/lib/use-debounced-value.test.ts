import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./use-debounced-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 100));
    expect(result.current).toBe("a");
  });

  it("only updates after the delay with the latest value", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(50));
    rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });
});
