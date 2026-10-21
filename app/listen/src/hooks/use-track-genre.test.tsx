import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTrackGenre } from "./use-track-genre";
import { api } from "@/lib/api";
import type { Track } from "@/contexts/player-types";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
const genre = {
  primary: { slug: "grindcore", name: "Grindcore", canonical: true },
  topLevel: null,
  source: "album",
  preset: {
    gains: [2, 5, 6, 4, -3, -2, 4, 5, 2, 0],
    source: "direct",
    inheritedFrom: null,
  },
};
beforeEach(() => {
  vi.mocked(api).mockReset();
});
describe("useTrackGenre", () => {
  it("resolves the library genre of a catalog track instead of its empty global genre", async () => {
    vi.mocked(api).mockImplementation((path) =>
      Promise.resolve(
        path.includes("/by-entity/") ? genre : { primary: null, preset: null },
      ),
    );
    const track: Track = {
      id: "catalog-a",
      globalTrackUid: "catalog-a",
      entityUid: "library-a",
      libraryTrackId: 123,
      title: "Intro",
      artist: "BRAT",
    };
    const { result } = renderHook(() => useTrackGenre(track));
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", genre }),
    );
    expect(api).toHaveBeenCalledWith("/api/tracks/by-entity/library-a/genre");
  });
  it("retains global resolution for a catalog-only track", async () => {
    vi.mocked(api).mockResolvedValue(genre);
    const track: Track = {
      id: "catalog-b",
      globalTrackUid: "catalog-b",
      title: "Global",
      artist: "Artist",
    };
    const { result } = renderHook(() => useTrackGenre(track));
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", genre }),
    );
    expect(api).toHaveBeenCalledWith("/api/catalog/tracks/catalog-b/genre");
  });
});
