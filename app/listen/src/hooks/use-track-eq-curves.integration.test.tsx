import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));
import { api } from "@/lib/api";
import { cacheClear, connectCacheEvents } from "@/lib/cache";
import { useTrackEqCurves } from "./use-track-eq-curves";
const track = {
  id: "track-10",
  libraryTrackId: 10,
  title: "Track",
  artist: "Artist",
};
let disconnect: (() => void) | undefined;
afterEach(() => {
  disconnect?.();
  vi.unstubAllGlobals();
  cacheClear();
  vi.clearAllMocks();
});
it("withdraws cached curves after authoritative refresh failure", async () => {
  vi.mocked(api).mockResolvedValue([
    {
      source: "user_track_preset",
      gains: Array(10).fill(1),
      label: "Saved",
      reasoning: "",
      genre: null,
    },
  ]);
  const { result } = renderHook(() => useTrackEqCurves(track));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  vi.mocked(api).mockRejectedValue(
    Object.assign(new Error("Track not found"), { status: 404 }),
  );
  const stream = {
    onmessage: null as
      | null
      | ((event: { data: string; lastEventId: string }) => void),
    onopen: null,
    onerror: null,
    addEventListener: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal("EventSource", function () {
    return stream;
  });
  disconnect = connectCacheEvents();
  act(() => stream.onmessage?.({ data: "library", lastEventId: "test-event" }));
  await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(result.current).toEqual({ curves: [], status: "unavailable" }),
  );
});
