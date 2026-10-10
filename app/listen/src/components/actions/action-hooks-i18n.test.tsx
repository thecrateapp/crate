import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MemoryRouter, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openCreateCrate = vi.hoisted(() => vi.fn());
const openCrateComposerForAlbum = vi.hoisted(() =>
  vi.fn(
    (
      composer: { openCreateCrate: (options: { album: unknown }) => void },
      album: unknown,
    ) => {
      composer.openCreateCrate({ album });
      return true;
    },
  ),
);

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

vi.mock("@/contexts/CrateComposerContext", () => ({
  useOptionalCrateComposer: () => ({
    openCreateCrate,
  }),
  openCrateComposerForAlbum,
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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn((url: string | null) => ({
    data:
      url === "/api/me/crates"
        ? [{ id: "crate-1", name: "Year-end records" }]
        : null,
  })),
}));

import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { buildShowActions } from "@/components/actions/show-actions";
import { I18nProvider, type ListenLocale } from "@/i18n";
import { fetchAlbumRadio, fetchArtistRadio } from "@/lib/radio";
import { api } from "@/lib/api";

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
    | typeof buildShowActions
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
    openCreateCrate.mockReset();
    openCrateComposerForAlbum.mockClear();
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
          buildShowActions(
            {
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
            },
            { t: useTranslation().t, navigate: useNavigate() },
          ),
        ),
      }),
      { wrapper: i18nWrapper("es") },
    );

    expect(result.current.album).toEqual(
      expect.arrayContaining([
        "Reproducir álbum",
        "Reproducir después",
        "Reproducir álbum aleatoriamente",
        "Añadir a colección",
        "Iniciar radio de álbum",
        "Disponible offline",
        "Descargar ZIP del álbum",
        "Ir al artista",
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
        "Seguir playlist",
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

  it("adds an album to a selected Crate", async () => {
    const { result } = renderHook(
      () =>
        useAlbumActionEntries({
          globalAlbumUid: "global-blending",
          artist: "High Vis",
          album: "Blending",
        }),
      { wrapper: i18nWrapper("es") },
    );

    const crateMenu = result.current.find((entry) => entry.key === "crate");
    if (!crateMenu || crateMenu.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }

    expect(crateMenu.label).toBe("Añadir a Crate");
    act(() => {
      crateMenu.onToggle();
    });
    const expandedCrateMenu = result.current.find(
      (entry) => entry.key === "crate",
    );
    if (!expandedCrateMenu || expandedCrateMenu.type !== "disclosure") {
      throw new Error("Crate menu missing after expansion");
    }
    const crateItem = expandedCrateMenu.items.find(
      (item) => item.key === "crate-crate-1",
    );
    if (!crateItem || !("onSelect" in crateItem)) {
      throw new Error("Crate option missing");
    }
    await act(async () => {
      await crateItem.onSelect?.();
    });

    expect(api).toHaveBeenCalledWith("/api/crates/crate-1/albums", "POST", {
      global_album_uid: "global-blending",
    });
  });

  it("opens the Crate composer with the selected album", async () => {
    const { result } = renderHook(
      () =>
        useAlbumActionEntries({
          globalAlbumUid: "global-blending",
          artist: "High Vis",
          album: "Blending",
        }),
      { wrapper: i18nWrapper("es") },
    );

    const crateMenu = result.current.find((entry) => entry.key === "crate");
    if (!crateMenu || crateMenu.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }

    act(() => {
      crateMenu.onToggle();
    });
    const expandedCrateMenu = result.current.find(
      (entry) => entry.key === "crate",
    );
    if (!expandedCrateMenu || expandedCrateMenu.type !== "disclosure") {
      throw new Error("Crate menu missing after expansion");
    }

    const createCrateItem = expandedCrateMenu.items.find(
      (item) => item.key === "crate-create",
    );
    if (!createCrateItem || !("onSelect" in createCrateItem)) {
      throw new Error("Create Crate option missing");
    }

    await act(async () => {
      await createCrateItem.onSelect?.();
    });

    expect(openCrateComposerForAlbum).toHaveBeenCalledWith(
      { openCreateCrate },
      {
        globalAlbumUid: "global-blending",
        name: "Blending",
        artistName: "High Vis",
      },
    );
    expect(openCreateCrate).toHaveBeenCalledWith({
      album: {
        globalAlbumUid: "global-blending",
        name: "Blending",
        artistName: "High Vis",
      },
    });
  });
});
