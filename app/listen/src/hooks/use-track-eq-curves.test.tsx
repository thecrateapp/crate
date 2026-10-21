import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
import { useApi } from "@/hooks/use-api";
import { useTrackEqCurves } from "./use-track-eq-curves";
import type { Track } from "@/contexts/player-types";
const track: Track = {
  id: "track-10",
  libraryTrackId: 10,
  title: "Track",
  artist: "Artist",
};
describe("useTrackEqCurves", () => {
  it("requests the canonical track inventory without changing EQ preferences", () => {
    const curves = [
      {
        source: "flat",
        gains: Array(10).fill(0),
        label: "",
        reasoning: "",
        genre: null,
      },
    ];
    vi.mocked(useApi).mockReturnValue({
      data: curves,
      loading: false,
    } as ReturnType<typeof useApi>);
    const { result } = renderHook(() => useTrackEqCurves(track));
    expect(result.current.curves).toEqual(curves);
    expect(result.current.status).toBe("ready");
    expect(
      vi.mocked(useApi).mock.calls[
        vi.mocked(useApi).mock.calls.length - 1
      ]?.[0],
    ).toMatch(/\/eq\/curves$/);
  });
  it("keeps missing and old-server inventory unknown and skips without track", () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: false,
      error: "Not found",
    } as unknown as ReturnType<typeof useApi>);
    const { result, rerender } = renderHook(
      ({ track }) => useTrackEqCurves(track),
      { initialProps: { track: track as Track | undefined } },
    );
    expect(result.current).toEqual({ curves: null, status: "unavailable" });
    rerender({ track: undefined });
    expect(result.current).toEqual({ curves: null, status: "idle" });
    expect(
      vi.mocked(useApi).mock.calls[
        vi.mocked(useApi).mock.calls.length - 1
      ]?.[0],
    ).toBeNull();
  });
});
