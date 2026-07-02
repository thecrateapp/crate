import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { useApi } from "@/hooks/use-api";
import { Playlist } from "./Playlist";
import { CuratedPlaylist } from "./CuratedPlaylist";
import { HomePlaylist } from "./HomePlaylist";

const trackRowProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-lazy-playlist-options", () => ({
  useLazyPlaylistOptions: () => ({
    playlistOptions: [],
    ensurePlaylistOptionsLoaded: vi.fn(),
  }),
}));

vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({
    openCreatePlaylist: vi.fn(),
  }),
}));

vi.mock("@/components/ui/WindowVirtualList", () => ({
  WindowVirtualList: <T,>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (item: T, index: number) => ReactNode;
  }) => <div>{items.map((item, index) => renderItem(item, index))}</div>,
}));

vi.mock("@/components/cards/TrackRow", () => ({
  TrackRow: (props: Record<string, unknown>) => {
    trackRowProps.push(props);
    const track = props.track as { title?: string };
    return (
      <div
        data-testid="track-row"
        data-show-cover-thumb={props.showCoverThumb ? "true" : "false"}
      >
        {track.title}
      </div>
    );
  },
}));

vi.mock("@/components/playlists/PlaylistArtwork", () => ({
  PlaylistArtwork: ({ name }: { name?: string }) => (
    <div data-testid="plain-playlist-artwork">{name}</div>
  ),
}));

vi.mock("@/components/playlists/EditorialPlaylistArtwork", () => ({
  EditorialPlaylistArtwork: ({ title }: { title: string }) => (
    <div data-testid="editorial-playlist-artwork">{title}</div>
  ),
  editorialPlaylistLabel: (name: string) => ({ title: name, kicker: "" }),
}));

vi.mock("@/components/playlists/PlaylistHeroSection", () => ({
  PlaylistHeroSection: ({
    title,
    subtitle,
    metaItems,
    secondaryActions,
    menuItems,
    artwork,
  }: {
    title: string;
    subtitle?: string;
    metaItems?: Array<string | null | undefined | false>;
    secondaryActions?: Array<{ label: string; ariaLabel?: string }>;
    menuItems?: Array<{ type?: string; label?: string }>;
    artwork: (className: string) => ReactNode;
  }) => (
    <section data-testid="playlist-hero">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {metaItems
        ?.filter(Boolean)
        .map((item) => <span key={String(item)}>{item}</span>)}
      <div role="group" aria-label="Secondary playlist actions">
        {secondaryActions?.map((action) => (
          <button
            key={action.ariaLabel || action.label}
            type="button"
            aria-label={action.ariaLabel || action.label}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div>
        {menuItems
          ?.filter((item) => item.type !== "divider" && item.label)
          .map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
      {artwork("hero-artwork")}
    </section>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const playlistTrack = {
  id: 1,
  playlist_id: 42,
  track_id: 10,
  track_entity_uid: "track-10",
  track_path: "Band/Album/Song.flac",
  title: "Song",
  artist: "Band",
  artist_id: 7,
  artist_entity_uid: "artist-7",
  artist_slug: "band",
  album: "Album",
  album_id: 12,
  album_entity_uid: "album-12",
  album_slug: "album",
  duration: 180,
  position: 1,
  added_at: "2026-06-01T00:00:00Z",
};

const basePlaylist = {
  id: 42,
  name: "Screamo",
  description: "Raw nerves.",
  cover_data_url: "/api/playlists/42/cover",
  is_smart: false,
  track_count: 1,
  total_duration: 180,
  artwork_tracks: [playlistTrack],
  tracks: [playlistTrack],
};

const mockUseApi = vi.mocked(useApi);

describe("playlist pages", () => {
  beforeEach(() => {
    trackRowProps.length = 0;
    vi.clearAllMocks();
    mockUseApi.mockImplementation((url: string | null) => {
      if (url === "/api/playlists/42") {
        return {
          data: {
            ...basePlaylist,
            visibility: "public",
            user_id: 1,
            is_collaborative: false,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/curation/playlists/42") {
        return {
          data: {
            ...basePlaylist,
            is_curated: true,
            category: "editorial",
            follower_count: 3,
            is_followed: false,
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/me/home/playlists/screamo?v=2") {
        return {
          data: {
            id: "screamo",
            name: "Screamo",
            description: "Raw nerves.",
            artwork_tracks: [playlistTrack],
            artwork_artists: [],
            track_count: 1,
            total_duration: 180,
            badge: "Editorial",
            kind: "playlist",
            tracks: [playlistTrack],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  it("shows album cover thumbs in user playlist tracklists", () => {
    renderWithListenProviders(<Playlist />, {
      route: "/playlists/42",
      path: "/playlists/:id",
    });

    expect(screen.getByTestId("track-row")).toHaveAttribute(
      "data-show-cover-thumb",
      "true",
    );
  });

  it("shows album cover thumbs in generated playlist tracklists", () => {
    renderWithListenProviders(<HomePlaylist />, {
      route: "/home/playlist/screamo",
      path: "/home/playlist/:playlistId",
    });

    expect(screen.getByTestId("track-row")).toHaveAttribute(
      "data-show-cover-thumb",
      "true",
    );
  });

  it("keeps curated playlist hero artwork clean and moves text to the hero layout", () => {
    renderWithListenProviders(<CuratedPlaylist />, {
      route: "/playlists/curated/42",
      path: "/playlists/curated/:id",
    });

    const hero = screen.getByTestId("playlist-hero");
    expect(hero).toHaveTextContent("Screamo");
    expect(
      screen.queryByTestId("editorial-playlist-artwork"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("plain-playlist-artwork")).toBeInTheDocument();
    expect(screen.getByTestId("track-row")).toHaveAttribute(
      "data-show-cover-thumb",
      "true",
    );
  });

  it("localizes playlist page chrome", () => {
    renderWithListenProviders(<Playlist />, {
      locale: "es",
      route: "/playlists/42",
      path: "/playlists/:id",
    });

    const hero = screen.getByTestId("playlist-hero");
    expect(hero).toHaveTextContent("Playlist pública");
    expect(hero).toHaveTextContent("1 canción");
    expect(hero).toHaveTextContent("Compartir");
    expect(hero).toHaveTextContent("Reproducir playlist");
    expect(
      screen.getByPlaceholderText("Filtrar por título, artista o álbum"),
    ).toBeInTheDocument();
  });

  it("localizes curated and generated playlist chrome", () => {
    renderWithListenProviders(<CuratedPlaylist />, {
      locale: "es",
      route: "/playlists/curated/42",
      path: "/playlists/curated/:id",
    });

    expect(screen.getByTestId("playlist-hero")).toHaveTextContent(
      "Playlist de Crate",
    );
    expect(screen.getByTestId("playlist-hero")).toHaveTextContent(
      "3 seguidores",
    );

    renderWithListenProviders(<HomePlaylist />, {
      locale: "es",
      route: "/home/playlist/screamo",
      path: "/home/playlist/:playlistId",
    });

    expect(screen.getAllByTestId("playlist-hero")[1]).toHaveTextContent(
      "Playlist generada",
    );
    expect(screen.getAllByTestId("playlist-hero")[1]).toHaveTextContent(
      "Generada para ti",
    );
  });
});
