import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { useArtistEnrichment } from "./use-artist-data";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

const mockApi = vi.mocked(api);

describe("useArtistEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refetches enrichment and exposes the refreshed payload", async () => {
    mockApi
      .mockResolvedValueOnce({ lastfm: { bio: "Old bio" } })
      .mockResolvedValueOnce({
        setlist: {
          probable_setlist: [
            { title: "New Song", frequency: 1, play_count: 2 },
          ],
        },
      });

    const { result } = renderHook(() => useArtistEnrichment(42));

    await waitFor(() => {
      expect(result.current.enrichment?.lastfm?.bio).toBe("Old bio");
    });

    let refreshed = null;
    await act(async () => {
      refreshed = await result.current.refetch();
    });

    expect(mockApi).toHaveBeenNthCalledWith(1, "/api/artists/42/enrichment");
    expect(mockApi).toHaveBeenNthCalledWith(2, "/api/artists/42/enrichment");
    expect(refreshed).toEqual(result.current.enrichment);
    expect(
      result.current.enrichment?.setlist?.probable_setlist?.[0]?.title,
    ).toBe("New Song");
  });
});
