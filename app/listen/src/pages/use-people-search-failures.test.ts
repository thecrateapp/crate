import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { usePeopleSearch } from "./use-people-search";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/hooks/use-debounced-value", () => ({
  useDebouncedValue: (v: string) => v,
}));
const person = {
  id: 2,
  username: "Jane",
  display_name: "Jane",
  avatar: null,
  bio: null,
  joined_at: "2026-01-01",
};
beforeEach(() => vi.mocked(api).mockReset());
afterEach(() => vi.useRealTimers());
it("does not show a failed search as an empty successful result and can retry", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([person]);
  const { result } = renderHook(() => usePeopleSearch("Jane"));
  await waitFor(() => expect(result.current.error).toBe(true));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.results).toEqual([person]));
  expect(result.current.error).toBe(false);
});
it("ignores an obsolete reply even when transport does not honor abort", async () => {
  let finish!: (v: unknown) => void;
  vi.mocked(api)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce([]);
  const { result, rerender } = renderHook(
    ({ query }) => usePeopleSearch(query),
    { initialProps: { query: "Jane" } },
  );
  rerender({ query: "Other" });
  await waitFor(() => expect(result.current.searching).toBe(false));
  await act(async () => finish([person]));
  expect(result.current.results).toEqual([]);
});
