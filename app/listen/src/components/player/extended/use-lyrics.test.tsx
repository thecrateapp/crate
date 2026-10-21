import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLyrics } from "./use-lyrics";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api }));
const track = { id: "one", title: "One", artist: "Artist" };
beforeEach(() => {
  api.mockReset();
});
it("falls back to plain lyrics when a timed response has no usable lines", async () => {
  api.mockResolvedValue({
    syncedLyrics: "invalid",
    plainLyrics: "Keep this line",
  });
  const { result } = renderHook(() => useLyrics(track));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.lyrics).toEqual({
    synced: null,
    plain: "Keep this line",
  });
});
it("distinguishes request failure from no lyrics and retries", async () => {
  api
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ syncedLyrics: null, plainLyrics: "Recovered" });
  const { result } = renderHook(() => useLyrics(track));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(true);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.lyrics?.plain).toBe("Recovered"));
  expect(result.current.error).toBe(false);
});
it("skips closed/absent tracks and ignores an old request after switching", async () => {
  let resolveOld!: (data: unknown) => void;
  api
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ syncedLyrics: null, plainLyrics: "New" });
  const { result, rerender } = renderHook(({ current }) => useLyrics(current), {
    initialProps: { current: undefined as typeof track | undefined },
  });
  expect(api).not.toHaveBeenCalled();
  rerender({ current: track });
  const signal = api.mock.calls[0]![3].signal;
  rerender({ current: { ...track, id: "two", title: "Two" } });
  await waitFor(() => expect(result.current.lyrics?.plain).toBe("New"));
  await act(async () => resolveOld({ syncedLyrics: null, plainLyrics: "Old" }));
  expect(signal.aborted).toBe(true);
  expect(result.current.lyrics?.plain).toBe("New");
});
it("clears loading and error when the current track is removed", () => {
  api.mockReturnValue(new Promise(() => {}));
  const { result, rerender } = renderHook(({ current }) => useLyrics(current), {
    initialProps: { current: track as typeof track | null },
  });
  expect(result.current.loading).toBe(true);
  rerender({ current: null });
  expect(result.current).toMatchObject({
    lyrics: null,
    loading: false,
    error: false,
  });
});
