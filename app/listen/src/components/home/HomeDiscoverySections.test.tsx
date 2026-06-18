import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EssentialsSection,
  HomeTasteHero,
  RadioStationCard,
  RadioStationsSection,
  RecentEntityRow,
  RecentlyPlayedSection,
} from "@/components/home/HomeDiscoverySections";
import type {
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeRadioStation,
  HomeRecentItem,
} from "@/components/home/home-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

function mockDesktopPointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("min-width: 768px") ||
        query === "(hover: hover) and (pointer: fine)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockMobilePointer() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("hover: none") || query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  mockDesktopPointer();
});

function heroFixture(overrides: Partial<HomeHeroArtist> = {}): HomeHeroArtist {
  return {
    id: 7,
    slug: "converge",
    name: "Converge",
    listeners: 639_200,
    scrobbles: 52_600_000,
    album_count: 9,
    track_count: 118,
    bio: "Converge are a Massachusetts hardcore band.",
    ...overrides,
  };
}

describe("HomeTasteHero", () => {
  it("uses shared genre pills and omits the recommended badge", () => {
    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            genres: ["Hardcore", "Mathcore", "Metalcore"],
          }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
        onInfo={vi.fn()}
      />,
    );

    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.getByTitle("Hardcore")).toHaveClass("rounded-md");
    expect(screen.getByText("hardcore")).toBeInTheDocument();
    expect(screen.getByText("mathcore")).toBeInTheDocument();
    expect(screen.queryByText("metalcore")).toBeNull();
  });

  it("records hero exposure and dismisses the current artist", async () => {
    const hero = heroFixture();
    const onExpose = vi.fn();
    const onDismiss = vi.fn();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[hero]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
        onInfo={vi.fn()}
        onDismiss={onDismiss}
        onExpose={onExpose}
      />,
    );

    await waitFor(() => expect(onExpose).toHaveBeenCalledWith(hero));

    const [, dismissButton] = screen.getAllByRole("button", {
      name: /Not interested/i,
    });
    if (!dismissButton) {
      throw new Error("Expected the visible dismiss button to render");
    }
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledWith(hero);
  });

  it("hides carousel arrow buttons on mobile", () => {
    mockMobilePointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
        onInfo={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("moves the mobile carousel with a natural horizontal swipe", () => {
    mockMobilePointer();
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-06-18T10:00:00.000Z"));
      renderWithListenProviders(
        <HomeTasteHero
          heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
          isFollowing={() => false}
          onOpenArtist={vi.fn()}
          onPlay={vi.fn()}
          onToggleFollow={vi.fn()}
          onInfo={vi.fn()}
        />,
      );

      const activeSlide = screen.getByRole("button", { name: /Converge/i });

      fireEvent.touchStart(activeSlide, {
        touches: [{ clientX: 240, clientY: 180 }],
      });
      vi.setSystemTime(new Date("2026-06-18T10:00:00.720Z"));
      fireEvent.touchEnd(activeSlide, {
        changedTouches: [{ clientX: 132, clientY: 194 }],
      });

      expect(
        screen.getByRole("heading", { name: "Botch" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RecentEntityRow", () => {
  it("shows only the first four recently played rows on mobile and keeps view all", () => {
    mockMobilePointer();
    const onViewAll = vi.fn();
    const items: HomeRecentItem[] = Array.from({ length: 6 }, (_, index) => ({
      type: "album",
      album_id: index + 1,
      album_name: `Recent Album ${index + 1}`,
      artist_name: `Artist ${index + 1}`,
    }));

    renderWithListenProviders(
      <RecentlyPlayedSection
        items={items}
        onOpenItem={vi.fn()}
        onViewAll={onViewAll}
      />,
    );

    expect(screen.getByText("Recent Album 1")).toBeInTheDocument();
    expect(screen.getByText("Recent Album 4")).toBeInTheDocument();
    expect(screen.queryByText("Recent Album 5")).toBeNull();
    expect(screen.queryByText("Recent Album 6")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll Recently played left" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll Recently played right" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View all/i }));

    expect(onViewAll).toHaveBeenCalledWith("recently-played");
  });

  it("does not render type badges on recently played rows", () => {
    const items: HomeRecentItem[] = [
      {
        type: "album",
        album_id: 42,
        album_name: "El Cielo",
        artist_name: "Dredg",
      },
      {
        type: "artist",
        artist_id: 7,
        artist_name: "Hum",
      },
      {
        type: "playlist",
        playlist_id: 12,
        playlist_name: "Morning Rotation",
        playlist_description: "Recent favorites",
        playlist_scope: "user",
      },
    ];

    renderWithListenProviders(
      <div>
        {items.map((item) => (
          <RecentEntityRow key={item.type} item={item} onClick={vi.fn()} />
        ))}
      </div>,
    );

    const albumRow = screen.getByRole("button", { name: /El Cielo/i });
    const artistRow = screen.getByRole("button", { name: /Hum/i });
    const playlistRow = screen.getByRole("button", {
      name: /Morning Rotation/i,
    });

    expect(within(albumRow).queryByText("album")).toBeNull();
    expect(within(artistRow).queryByText("artist")).toBeNull();
    expect(within(playlistRow).queryByText("playlist")).toBeNull();
  });

  it("opens the normalized album context menu from a recent album card", async () => {
    const item: HomeRecentItem = {
      type: "album",
      album_id: 42,
      album_name: "El Cielo",
      artist_name: "Dredg",
      artist_id: 7,
      artist_slug: "dredg",
      album_slug: "el-cielo",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /El Cielo/i }), {
      clientX: 160,
      clientY: 120,
    });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-2xl");
    expect(within(menu).getByText("El Cielo")).toBeInTheDocument();
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share album" }),
    ).toBeInTheDocument();
  });

  it("opens the normalized artist context menu from the more button", async () => {
    const item: HomeRecentItem = {
      type: "artist",
      artist_id: 7,
      artist_name: "Dredg",
      artist_slug: "dredg",
      subtitle: "Artist",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share artist" }),
    ).toBeInTheDocument();
  });

  it("opens the normalized playlist context menu from a recent playlist card", async () => {
    const item: HomeRecentItem = {
      type: "playlist",
      playlist_id: 12,
      playlist_name: "Morning Rotation",
      playlist_description: "Recent favorites",
      playlist_scope: "user",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Morning Rotation/i }),
      {
        clientX: 160,
        clientY: 120,
      },
    );

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Morning Rotation")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share playlist" }),
    ).toBeInTheDocument();
  });
});

describe("RadioStationCard", () => {
  it("shows the radio seed type and removes generic subtitle copy", () => {
    const station: HomeRadioStation = {
      type: "artist",
      title: "Converge Radio",
      seed_type: "artist",
      seed_label: "Converge",
      subtitle: "Based on your heavy rotation",
      play_count: 24,
      artist_name: "Converge",
      artist_id: 7,
      artist_slug: "converge",
    };

    renderWithListenProviders(
      <RadioStationCard station={station} onPlay={vi.fn()} />,
    );

    expect(screen.getByText("Artist Radio")).toBeInTheDocument();
    expect(screen.getByText("Converge")).toBeInTheDocument();
    expect(screen.queryByText("Based on your heavy rotation")).toBeNull();
  });
});

describe("RadioStationsSection", () => {
  it("uses the shared square-card rail fit", () => {
    const stations: HomeRadioStation[] = [
      {
        type: "artist",
        title: "Converge Radio",
        seed_type: "artist",
        seed_label: "Converge",
        subtitle: "",
        play_count: 24,
        artist_name: "Converge",
        artist_id: 7,
      },
    ];

    const { container } = renderWithListenProviders(
      <RadioStationsSection
        stations={stations}
        onPlayStation={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-rail-fit="square-card"]')).not.toBe(
      null,
    );
  });
});

describe("EssentialsSection", () => {
  it("labels generated home core-track playlists as Artist Sets", () => {
    const items: HomeGeneratedPlaylistSummary[] = [
      {
        id: "core-tracks-artist-1",
        name: "Converge",
        description: "A discovery route into Converge.",
        artwork_tracks: [],
        artwork_artists: [],
        track_count: 8,
        badge: "Core Tracks",
        kind: "core",
      },
    ];

    renderWithListenProviders(
      <EssentialsSection
        items={items}
        onOpenPlaylist={vi.fn()}
        onPlayPlaylist={vi.fn()}
        onShufflePlaylist={vi.fn()}
        onStartRadio={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    expect(screen.getByText("Artist Sets")).toBeInTheDocument();
    expect(screen.queryByText("Core tracks")).toBeNull();
  });
});
