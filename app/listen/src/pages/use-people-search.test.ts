import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import {
  PEOPLE_SEARCH_DEBOUNCE_MS,
  usePeopleSearch,
} from "@/pages/use-people-search";

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => []),
}));

describe("usePeopleSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces typing into a single request", async () => {
    const { rerender, result } = renderHook(
      ({ query }) => usePeopleSearch(query),
      { initialProps: { query: "" } },
    );
    rerender({ query: "a" });
    rerender({ query: "al" });
    rerender({ query: "ali" });

    expect(result.current.searching).toBe(true);
    expect(api).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(PEOPLE_SEARCH_DEBOUNCE_MS);
    });

    expect(api).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api).mock.calls[0]?.[0]).toBe(
      "/api/users/search?q=ali&limit=12",
    );
  });

  it("does not request for empty or blank queries", async () => {
    const { result } = renderHook(() => usePeopleSearch("   "));

    await act(async () => {
      vi.advanceTimersByTime(PEOPLE_SEARCH_DEBOUNCE_MS * 2);
    });

    expect(api).not.toHaveBeenCalled();
    expect(result.current.searching).toBe(false);
    expect(result.current.results).toEqual([]);
  });
});
