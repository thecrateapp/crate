import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { startShapedRadio } from "@/lib/radio";
import { SHARE_REQUEST_EVENT, type SharePayload } from "@/lib/social-share";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Explore } from "./Explore";

const viewportState = vi.hoisted(() => ({ isDesktop: false }));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/radio", () => ({
  startShapedRadio: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => viewportState.isDesktop,
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(),
  }),
}));

describe("Explore", () => {
  beforeEach(() => {
    viewportState.isDesktop = false;
    vi.mocked(useApi).mockReset();
    vi.mocked(startShapedRadio).mockReset();
  });

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
    expect(useApi).toHaveBeenCalledTimes(1);
    expect(useApi).not.toHaveBeenCalledWith(
      "/api/me/home/discovery",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("renders stronger feature cards and genre room editorial copy", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        playlists: [],
        moods: [],
        filters: {
          genres: [
            {
              name: "Mathcore",
              count: 12,
              description: "Angular hardcore, odd meters and controlled chaos.",
              top_artists: ["Converge", "Botch", "The Dillinger Escape Plan"],
              cover_url: "/api/genres/mathcore/cover",
            },
          ],
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

    expect(
      screen.getByText("Start from a track, artist, album or genre."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Find the route between scenes, artists and records."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Angular hardcore, odd meters and controlled chaos."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Scene")).toBeNull();
    expect(screen.queryByText("12 artists indexed")).toBeNull();
  });

  it("localizes the Explore landing sections", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        playlists: [],
        moods: [],
        filters: {
          genres: [
            {
              name: "Mathcore",
              count: 12,
              description: "Angular hardcore, odd meters and controlled chaos.",
              top_artists: ["Converge"],
              cover_url: "/api/genres/mathcore/cover",
            },
          ],
          decades: ["1990s"],
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
      locale: "es",
    });

    expect(
      screen.getByRole("heading", { name: "Explorar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Empieza desde una canción, artista, álbum o género."),
    ).toBeInTheDocument();
    expect(screen.getByText("Salas de género")).toBeInTheDocument();
    expect(screen.getByText("Túneles temporales")).toBeInTheDocument();
    expect(screen.getByText("Sala de género")).toBeInTheDocument();
  });

  it("opens genre detail using backend-provided genre slug", () => {
    vi.mocked(useApi).mockImplementation((url: string | null) => {
      if (url === "/api/browse/explore-page") {
        return {
          data: {
            playlists: [],
            moods: [],
            filters: {
              genres: [
                {
                  name: "Punk/Hardcore",
                  slug: "punk-hardcore",
                  count: 4,
                  top_artists: ["Converge"],
                  cover_url:
                    "/api/genres/punk-hardcore/cover?size=640&format=webp",
                },
              ],
              decades: [],
              formats: [],
              moods: [],
            },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (url === "/api/catalog/genres/punk-hardcore") {
        return {
          data: {
            id: 1,
            name: "Punk/Hardcore",
            slug: "punk-hardcore",
            artist_count: 1,
            album_count: 1,
            track_count: 1,
            artists: [],
            albums: [],
            shows: [],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore",
      path: "/explore",
    });

    fireEvent.click(
      screen.getByText("Punk/Hardcore").closest("button") as HTMLElement,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Punk/Hardcore" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Genre not found.")).toBeNull();
  });

  it("renders a public genre hero with cover, description, and stats", () => {
    vi.mocked(useApi).mockImplementation((url: string | null) => {
      if (url === "/api/browse/explore-page") {
        return {
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
        };
      }

      if (url === "/api/catalog/genres/hardcore") {
        return {
          data: {
            id: 1,
            name: "hardcore",
            slug: "hardcore",
            canonical_slug: "hardcore-punk",
            description: "Fast, urgent and built around community pressure.",
            cover_url: "/api/genres/hardcore/cover?size=640&format=webp",
            artist_count: 12,
            album_count: 43,
            track_count: 118,
            artists: [],
            albums: [],
            shows: [],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "hardcore" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fast, urgent and built around community pressure."),
    ).toBeInTheDocument();
    expect(screen.getByText("12 artists")).toBeInTheDocument();
    expect(screen.getByText("43 albums")).toBeInTheDocument();
    expect(screen.getByText("118 tracks")).toBeInTheDocument();
    expect(screen.queryByText("Mapped")).toBeNull();
    expect(screen.queryByText("Unmapped")).toBeNull();
    expect(screen.getByAltText("hardcore genre cover")).toHaveAttribute(
      "src",
      "/api/genres/hardcore/cover?size=1280&format=webp&hero=genre-detail-v5",
    );
  });

  it("renders genre hero actions, shows, and no internal back button", () => {
    mockGenreDetail({
      shows: [
        {
          id: 10,
          type: "show",
          date: "2030-07-03",
          artist: "Converge",
          artist_id: 1,
          artist_slug: "converge",
          title: "Circolo Magnolia",
          subtitle: "Segrate, Italy",
          cover_url: null,
          status: "onsale",
          venue: "Circolo Magnolia",
          city: "Segrate",
          country: "Italy",
          genres: ["hardcore"],
          is_upcoming: true,
        },
      ],
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(
      screen.queryByRole("button", { name: "Back to Explore" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Play genre radio" }),
    ).toHaveTextContent("Play");
    expect(
      screen.getByRole("button", { name: "Open next genre show in Radar" }),
    ).toHaveTextContent("Next show");
    expect(
      screen.getByTestId("genre-mobile-hero-menu").parentElement,
    ).toHaveClass("fixed", "z-app-header");
    expect(screen.getByRole("heading", { name: "Shows" })).toBeInTheDocument();
    expect(screen.getByText("Converge")).toBeInTheDocument();
    expect(screen.getByText("Circolo Magnolia")).toBeInTheDocument();
  });

  it("hides the inline secondary genre action row on mobile", () => {
    mockGenreDetail();

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(
      screen.queryByRole("group", { name: "Secondary genre actions" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Share genre" })).toBeNull();
    expect(screen.getByTestId("genre-mobile-hero-menu")).toBeInTheDocument();
  });

  it("groups public genre actions into primary pills and secondary icon labels", () => {
    viewportState.isDesktop = true;
    mockGenreDetail({
      shows: [
        {
          id: 10,
          type: "show",
          date: "2030-07-03",
          artist: "Converge",
          artist_id: 1,
          artist_slug: "converge",
          title: "Circolo Magnolia",
          subtitle: "Segrate, Italy",
          cover_url: null,
          status: "onsale",
          venue: "Circolo Magnolia",
          city: "Segrate",
          country: "Italy",
          genres: ["hardcore"],
          is_upcoming: true,
        },
      ],
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    const primary = screen.getByRole("group", {
      name: "Primary genre actions",
    });
    expect(
      within(primary).getByRole("button", { name: "Play genre radio" }),
    ).toHaveTextContent("Play");
    expect(
      within(primary).getByRole("button", {
        name: "Open next genre show in Radar",
      }),
    ).toHaveTextContent("Next show");

    const secondary = screen.getByRole("group", {
      name: "Secondary genre actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Share genre" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "More" }),
    ).toHaveTextContent("More");
  });

  it("opens the shared share sheet for public genres", () => {
    viewportState.isDesktop = true;
    mockGenreDetail();
    let sharePayload: SharePayload | null = null;
    const onShare = (event: Event) => {
      sharePayload = (event as CustomEvent<SharePayload>).detail;
    };
    window.addEventListener(SHARE_REQUEST_EVENT, onShare);

    try {
      renderWithListenProviders(<Explore />, {
        route: "/explore?genre=hardcore",
        path: "/explore",
      });

      fireEvent.click(screen.getByRole("button", { name: "Share genre" }));

      expect(sharePayload).toMatchObject({
        kind: "genre",
        title: "hardcore",
        subtitle: "Genre",
        imageUrl:
          "/api/genres/hardcore/cover?size=1280&format=webp&hero=genre-detail-v5",
        url: expect.stringContaining("/explore?genre=hardcore"),
      });
    } finally {
      window.removeEventListener(SHARE_REQUEST_EVENT, onShare);
    }
  });

  it("falls back to the canonical genre cover when cached detail has no cover url", () => {
    mockGenreDetail({ coverUrl: null });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(screen.getByAltText("hardcore genre cover")).toHaveAttribute(
      "src",
      "/api/genres/hardcore-punk/cover?size=1280&format=webp&hero=genre-detail-v5",
    );
  });

  it("falls back to the canonical genre cover when hero image fails to load", async () => {
    mockGenreDetail();

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    const heroImage = screen.getByAltText("hardcore genre cover");

    expect(heroImage).toHaveAttribute(
      "src",
      "/api/genres/hardcore/cover?size=1280&format=webp&hero=genre-detail-v5",
    );

    fireEvent.error(heroImage);

    await waitFor(() => {
      expect(screen.getByAltText("hardcore genre cover")).toHaveAttribute(
        "src",
        "/api/genres/hardcore-punk/cover?size=1280&format=webp&hero=genre-detail-v5",
      );
    });
  });

  it("falls back to top artist photo when genre hero candidates fail", async () => {
    mockGenreDetail({
      coverUrl: null,
      artists: [
        {
          artist_id: 111,
          artist_name: "Less Popular",
          artist_slug: "less-popular",
          album_count: 3,
          track_count: 6,
          has_photo: true,
          listeners: 120,
        },
        {
          artist_id: 222,
          artist_name: "Most Popular",
          artist_slug: "most-popular",
          album_count: 5,
          track_count: 9,
          has_photo: true,
          listeners: 999,
        },
      ],
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    const heroImage = screen.getByAltText("hardcore genre cover");

    expect(heroImage).toHaveAttribute(
      "src",
      "/api/genres/hardcore-punk/cover?size=1280&format=webp&hero=genre-detail-v5",
    );

    fireEvent.error(heroImage);

    await waitFor(() => {
      expect(screen.getByAltText("hardcore genre cover")).toHaveAttribute(
        "src",
        "/api/artists/222/photo?size=1280&format=webp&hero=genre-detail-v5",
      );
    });
  });

  it("starts seeded radio from the canonical genre slug", async () => {
    const playAll = vi.fn();
    vi.mocked(startShapedRadio).mockResolvedValue({
      sessionId: "radio-1",
      seedLabel: "Hardcore Punk",
      tracks: [
        {
          id: "track-1",
          title: "Track",
          artist: "Artist",
        },
      ],
      source: {
        type: "radio",
        name: "Hardcore Punk Radio",
        radio: {
          seedType: "genre",
          seedId: "hardcore-punk",
          shapedSessionId: "radio-1",
        },
      },
    });
    mockGenreDetail();

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
      playerActions: { playAll },
    });

    fireEvent.click(screen.getByRole("button", { name: "Play genre radio" }));

    expect(startShapedRadio).toHaveBeenCalledWith(
      "seeded",
      "genre",
      "hardcore-punk",
    );
    await waitFor(() => {
      expect(playAll).toHaveBeenCalled();
    });
  });

  it("limits public genre artists and albums on mobile", () => {
    mockGenreDetail();

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(screen.getByText("Genre Artist 12")).toBeInTheDocument();
    expect(screen.queryByText("Genre Artist 13")).toBeNull();
    expect(screen.getByText("Genre Album 12")).toBeInTheDocument();
    expect(screen.queryByText("Genre Album 13")).toBeNull();
  });

  it("limits public related genres on mobile", () => {
    mockGenreDetail({
      relatedGenres: Array.from({ length: 8 }, (_, index) => ({
        slug: `related-${index + 1}`,
        page_slug: `related-${index + 1}`,
        name: `Related Genre ${index + 1}`,
        relation_type: "related",
        relation_label: "Related",
        artist_count: 8 - index,
        album_count: 2,
      })),
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(screen.getByText("Related Genre 6")).toBeInTheDocument();
    expect(screen.queryByText("Related Genre 7")).toBeNull();
  });

  it("falls back related genre mini-card artwork through page genre, canonical genre, and top artist photo", () => {
    mockGenreDetail({
      relatedGenres: [
        {
          slug: "post-hardcore",
          page_slug: "post-hardcore-scene",
          name: "Post-hardcore",
          relation_type: "related",
          relation_label: "Related",
          artist_count: 8,
          album_count: 20,
          cover_url: null,
          top_artist_photo_url: "/api/artists/42/photo?size=640&format=webp",
        },
      ],
    });

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    const card = screen.getByRole("button", { name: /Post-hardcore/i });
    const image = card.querySelector("img");

    expect(image).toHaveAttribute(
      "src",
      "/api/genres/post-hardcore-scene/cover?size=640&format=webp",
    );

    fireEvent.error(image!);
    expect(card.querySelector("img")).toHaveAttribute(
      "src",
      "/api/genres/post-hardcore/cover?size=640&format=webp",
    );

    fireEvent.error(card.querySelector("img")!);
    expect(card.querySelector("img")).toHaveAttribute(
      "src",
      "/api/artists/42/photo?size=640&format=webp",
    );
  });

  it("keeps the full public genre grid on desktop", () => {
    viewportState.isDesktop = true;
    mockGenreDetail();

    renderWithListenProviders(<Explore />, {
      route: "/explore?genre=hardcore",
      path: "/explore",
    });

    expect(screen.getByText("Genre Artist 13")).toBeInTheDocument();
    expect(screen.getByText("Genre Album 13")).toBeInTheDocument();
  });
});

function mockGenreDetail(
  overrides: {
    coverUrl?: string | null;
    artists?: Array<{
      artist_id: number;
      artist_name: string;
      artist_slug?: string;
      album_count: number;
      track_count: number;
      has_photo: boolean;
      listeners: number | null;
    }>;
    relatedGenres?: Array<Record<string, unknown>>;
    shows?: Array<Record<string, unknown>>;
  } = {},
) {
  vi.mocked(useApi).mockImplementation((url: string | null) => {
    if (url === "/api/browse/explore-page") {
      return {
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
      };
    }

    if (url === "/api/catalog/genres/hardcore") {
      return {
        data: {
          id: 1,
          name: "hardcore",
          slug: "hardcore",
          canonical_slug: "hardcore-punk",
          description: "Fast, urgent and built around community pressure.",
          cover_url:
            overrides.coverUrl === undefined
              ? "/api/genres/hardcore/cover?size=640&format=webp"
              : overrides.coverUrl,
          artist_count: 13,
          album_count: 13,
          track_count: 39,
          related_genres: overrides.relatedGenres || [],
          artists: Array.from({ length: 13 }, (_, index) => ({
            artist_id: index + 1,
            artist_name: `Genre Artist ${index + 1}`,
            artist_slug: `genre-artist-${index + 1}`,
            album_count: index + 1,
            track_count: index + 1,
            has_photo: false,
            listeners: 0,
          })),
          ...(overrides.artists
            ? {
                artists: overrides.artists,
              }
            : {}),
          albums: Array.from({ length: 13 }, (_, index) => ({
            album_id: index + 1,
            album_slug: `genre-album-${index + 1}`,
            artist: "Genre Artist 1",
            name: `Genre Album ${index + 1}`,
            year: 2020 + index,
            track_count: 1,
            has_cover: true,
          })),
          shows: overrides.shows || [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
}
