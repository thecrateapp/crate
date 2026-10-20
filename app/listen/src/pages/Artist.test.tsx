import { fireEvent, screen } from "@testing-library/react";
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Artist temporarily unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      vi.mocked(useApi).mock.results[0]?.value.refetch,
    ).toHaveBeenCalledOnce();
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
  it.each([true, false])(
    "keeps the cached artist during a transient read failure (loading=%s)",
    (loading) => {
      vi.mocked(useApi).mockReturnValue({
        data: {
          artist: {
            id: 7,
            slug: "crossed",
            name: "Crossed",
            albums: [],
            total_tracks: 0,
            total_size_mb: 0,
            primary_format: null,
            genres: [],
            issue_count: 0,
            has_photo: false,
          },
          info: undefined,
          top_tracks: [],
          appears_on: [],
          enrichment: {},
          shows: { events: [], configured: false, source: "" },
        },
        loading,
        error: "Temporary failure",
        status: 502,
        refetch: vi.fn(),
      } as never);
      renderWithListenProviders(<Artist />, {
        route: "/artists/crossed",
        path: "/artists/:artistSlug",
      });
      expect(
        screen.getByRole("heading", { name: "Crossed" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Artist temporarily unavailable"),
      ).not.toBeInTheDocument();
    },
  );
  it("honors an authoritative404 even when a cached artist still exists", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        artist: {
          id: 7,
          slug: "crossed",
          name: "Crossed",
          albums: [],
          total_tracks: 0,
          total_size_mb: 0,
          primary_format: null,
          genres: [],
          issue_count: 0,
        },
        top_tracks: [],
        appears_on: [],
        enrichment: {},
        shows: { events: [], configured: false, source: "" },
      },
      loading: false,
      error: "Artist not found",
      status: 404,
      refetch: vi.fn(),
    } as never);
    renderWithListenProviders(<Artist />, {
      route: "/artists/crossed",
      path: "/artists/:artistSlug",
    });
    expect(screen.getByText("Artist not found")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Crossed" }),
    ).not.toBeInTheDocument();
  });
});
