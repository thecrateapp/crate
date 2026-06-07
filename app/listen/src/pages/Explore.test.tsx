import { describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Explore } from "./Explore";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(),
  }),
}));

describe("Explore", () => {
  it("does not request Home discovery by default", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        playlists: [],
        moods: [],
        filters: {
          genres: [],
          decades: [],
          formats: [],
          moods: [],
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore",
      path: "/explore",
    });

    expect(useApi).toHaveBeenCalledWith("/api/browse/explore-page");
    expect(useApi).toHaveBeenCalledWith(
      null,
      "GET",
      undefined,
      expect.objectContaining({ reactive: false }),
    );
    expect(useApi).not.toHaveBeenCalledWith(
      "/api/me/home/discovery",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
