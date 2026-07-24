import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    playAll: vi.fn(),
  }),
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(),
  }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(),
  }),
}));

vi.mock("@/contexts/OfflineContext", () => ({
  useOffline: () => ({
    supported: true,
    getAlbumState: () => "idle",
    getPlaylistState: () => "idle",
    toggleAlbumOffline: vi.fn(),
    togglePlaylistOffline: vi.fn(),
  }),
}));

vi.mock("@/lib/radio", () => ({
  fetchAlbumRadio: vi.fn(),
  fetchArtistRadio: vi.fn(),
  fetchPlaylistRadio: vi.fn(),
}));

import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { useShowActionEntries } from "@/components/actions/show-actions";
import { I18nProvider, type ListenLocale } from "@/i18n";
import { fetchAlbumRadio, fetchArtistRadio } from "@/lib/radio";

function i18nWrapper(locale: ListenLocale = "es") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </MemoryRouter>
    );
  };
}

function labels(
  entries: ReturnType<
    | typeof useAlbumActionEntries
    | typeof useArtistActionEntries
    | typeof usePlaylistActionEntries
    | typeof useShowActionEntries
  >,
) {
  return entries
    .filter((entry) => entry.type !== "divider")
    .map((entry) => entry.label);
}

describe("action hooks i18n", () => {
  beforeEach(() => {
    vi.mocked(fetchAlbumRadio).mockReset();
    vi.mocked(fetchArtistRadio).mockReset();
  });

  it("localizes album, artist, playlist, and show action labels", () => {
    const { result } = renderHook(
      () => ({
        album: labels(
          useAlbumActionEntries({
            artist: "High Vis",
            album: "Blending",
            albumId: 42,
          }),
        ),
        artist: labels(
          useArtistActionEntries({
            artistId: 12,
            name: "High Vis",
          }),
        ),
        playlist: labels(
          usePlaylistActionEntries({
            playlistId: 7,
            name: "Favorites",
            canFollow: true,
            isFollowed: false,
            href: "/playlists/7",
            onPlay: vi.fn(),
            onShuffle: vi.fn(),
            onToggleFollow: vi.fn(),
          }),
        ),
        show: labels(
          useShowActionEntries({
            item: {
              id: 1,
              type: "show",
              date: "2030-04-12",
              artist: "High Vis",
              artist_id: 12,
              title: "Sala Radar",
              subtitle: "Madrid, Spain",
              cover_url: null,
              status: "onsale",
              is_upcoming: true,
              url: "https://tickets.example.test",
            },
            attending: false,
            toggleAttendance: vi.fn(),
            playProbableSetlist: vi.fn(),
          }),
        ),
      }),
      { wrapper: i18nWrapper("es") },
    );

    expect(result.current.album).toEqual(
      expect.arrayContaining([
        "Reproducir álbum",
        "Reproducir álbum aleatoriamente",
        "Guardar álbum",
        "Iniciar radio de álbum",
        "Disponible offline",
        "Descargar ZIP del álbum",
        "Compartir álbum",
      ]),
    );
    expect(result.current.artist).toEqual(
      expect.arrayContaining([
        "Reproducir temas principales",
        "Reproducir temas principales aleatoriamente",
        "Seguir artista",
        "Iniciar radio de artista",
        "Compartir artista",
      ]),
    );
    expect(result.current.playlist).toEqual(
      expect.arrayContaining([
        "Reproducir playlist",
        "Reproducir playlist aleatoriamente",
        "Iniciar radio de playlist",
        "Añadir a tu biblioteca",
        "Disponible offline",
        "Compartir playlist",
      ]),
    );
    expect(result.current.show).toEqual(
      expect.arrayContaining([
        "Marcar asistencia",
        "Reproducir setlist probable",
        "Abrir artista",
        "Abrir entradas",
      ]),
    );
  });

  it("starts artist radio from global artist ids", async () => {
    vi.mocked(fetchArtistRadio).mockResolvedValue({
      tracks: [],
      source: { type: "radio", name: "High Vis Radio" },
    });
    const { result } = renderHook(
      () =>
        useArtistActionEntries({
          globalArtistUid: "global-high-vis",
          name: "High Vis",
        }),
      { wrapper: i18nWrapper("es") },
    );
    const radio = result.current.find((entry) => entry.key === "radio");
    if (
      !radio ||
      radio.type === "divider" ||
      radio.type === "label" ||
      radio.type === "disclosure"
    ) {
      throw new Error("radio action missing");
    }

    expect(radio.disabled).toBe(false);
    await act(async () => {
      await radio.onSelect();
    });

    expect(fetchArtistRadio).toHaveBeenCalledWith(
      "global-high-vis",
      "High Vis",
    );
  });

  it("starts album radio from global album ids", async () => {
    vi.mocked(fetchAlbumRadio).mockResolvedValue({
      tracks: [],
      source: { type: "radio", name: "Blending Radio" },
    });
    const { result } = renderHook(
      () =>
        useAlbumActionEntries({
          globalAlbumUid: "global-blending",
          artist: "High Vis",
          album: "Blending",
        }),
      { wrapper: i18nWrapper("es") },
    );
    const radio = result.current.find((entry) => entry.key === "radio");
    if (
      !radio ||
      radio.type === "divider" ||
      radio.type === "label" ||
      radio.type === "disclosure"
    ) {
      throw new Error("radio action missing");
    }

    expect(radio.disabled).toBe(false);
    await act(async () => {
      await radio.onSelect();
    });

    expect(fetchAlbumRadio).toHaveBeenCalledWith({
      albumId: "global-blending",
      artistName: "High Vis",
      albumName: "Blending",
    });
  });
});
