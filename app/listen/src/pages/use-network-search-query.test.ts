import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NETWORK_SEARCH_DEBOUNCE_MS,
  NETWORK_SEARCH_MIN_CHARS,
  networkSearchEligible,
  useNetworkSearchQuery,
} from "@/pages/use-network-search-query";

describe("useNetworkSearchQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Diego's values: 300 ms and at least 3 characters", () => {
    expect(NETWORK_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(NETWORK_SEARCH_MIN_CHARS).toBe(3);
  });

  it("sends a submitted query at once", () => {
    const { result } = renderHook(() =>
      useNetworkSearchQuery("joy division", true),
    );

    expect(result.current).toBe("joy division");
  });

  it("never fans out per keystroke: one query after the typing stops", () => {
    const sent: (string | null)[] = [];
    const { rerender } = renderHook(
      ({ query }) => {
        const value = useNetworkSearchQuery(query, true);
        if (sent.at(-1) !== value) sent.push(value);
        return value;
      },
      { initialProps: { query: "joy" } },
    );
    for (const query of ["joy d", "joy di", "joy div", "joy divi"]) {
      rerender({ query });
      act(() => {
        vi.advanceTimersByTime(NETWORK_SEARCH_DEBOUNCE_MS - 50);
      });
    }

    act(() => {
      vi.advanceTimersByTime(NETWORK_SEARCH_DEBOUNCE_MS);
    });

    expect(sent).toEqual(["joy", null, "joy divi"]);
  });

  it("does not send short queries", () => {
    const { result, rerender } = renderHook(
      ({ query }) => useNetworkSearchQuery(query, true),
      { initialProps: { query: "jo" } },
    );
    expect(result.current).toBeNull();

    rerender({ query: "j o" });
    act(() => {
      vi.advanceTimersByTime(NETWORK_SEARCH_DEBOUNCE_MS);
    });

    expect(result.current).toBeNull();
  });

  it("sends nothing while the server does not offer network search", () => {
    const { result } = renderHook(() =>
      useNetworkSearchQuery("joy division", false),
    );

    expect(result.current).toBeNull();
  });

  it("counts characters, not spaces", () => {
    expect(networkSearchEligible("  ab  ")).toBe(false);
    expect(networkSearchEligible("a b c")).toBe(true);
    expect(networkSearchEligible("abc")).toBe(true);
  });
});
