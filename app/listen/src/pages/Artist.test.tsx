import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Artist } from "./Artist";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

describe("Artist page request policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      status: null,
      refetch: vi.fn(),
    });
  });

  it("loads 50 top tracks in the page payload without a duplicate request", () => {
    renderWithListenProviders(<Artist />, {
      route: "/artists/high-vis",
      path: "/artists/:artistSlug",
    });

    expect(vi.mocked(useApi).mock.calls.map(([url]) => url)).toEqual([
      "/api/artist-slugs/high-vis/page?top_tracks_count=50",
    ]);
  });

  it("does not present a transient upstream failure as artist not found", () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: false,
      error: "Readplane fallback failed",
      status: 502,
      refetch: vi.fn(),
    } as never);

    renderWithListenProviders(<Artist />, {
      route: "/artists/fictitious-artist",
      path: "/artists/:artistSlug",
    });

    expect(screen.queryByText("Artist not found")).not.toBeInTheDocument();
    expect(
      screen.getByText("Artist temporarily unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveClass(
      "rounded-lg",
    );
  });

  it("presents a genuine 404 as artist not found", () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: false,
      error: "Artist not found",
      status: 404,
      refetch: vi.fn(),
    } as never);

    renderWithListenProviders(<Artist />, {
      route: "/artists/fictitious-artist",
      path: "/artists/:artistSlug",
    });

    expect(screen.getByText("Artist not found")).toBeInTheDocument();
  });
});
