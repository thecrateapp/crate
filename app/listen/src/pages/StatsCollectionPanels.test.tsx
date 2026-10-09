import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useArtistActionEntries } from "@/components/actions/artist-actions";
import {
  statsTrackRowData,
  type StatsAlbum,
  type StatsTrack,
} from "@/components/stats/stats-model";
import { toPlayableTrack } from "@/lib/playable-track";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import {
  TopAlbumsPanel,
  TopArtistsPanel,
  TopListenersPanel,
  TopTracksPanel,
} from "./StatsCollectionPanels";

vi.mock("@/components/actions/artist-actions", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/actions/artist-actions")
    >();
  return {
    ...actual,
    useArtistActionEntries: vi.fn(actual.useArtistActionEntries),
  };
});

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
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

const track: StatsTrack = {
  track_id: 1,
  track_path: "/music/fugazi/waiting-room.flac",
  title: "Waiting Room",
  artist: "Fugazi",
  album: "13 Songs",
  album_id: 2,
  play_count: 6,
  complete_play_count: 5,
  minutes_listened: 18,
};

const secondTrack: StatsTrack = {
  track_id: 4,
  track_path: "/music/fugazi/suggestion.flac",
  title: "Suggestion",
  artist: "Fugazi",
  album: "13 Songs",
  album_id: 2,
  play_count: 3,
  complete_play_count: 3,
  minutes_listened: 9,
};

const playSource = { type: "playlist" as const, name: "Top tracks" };

function renderTopTracks(
  items: StatsTrack[] = [track],
  options: Parameters<typeof renderWithListenProviders>[1] = {},
) {
  return renderWithListenProviders(
    <TopTracksPanel
      items={items}
      rows={items.map(statsTrackRowData)}
      loading={false}
      playSource={playSource}
    />,
    options,
  );
}

const album: StatsAlbum = {
  album_id: 2,
  album: "13 Songs",
  artist: "Fugazi",
  album_slug: "13-songs",
  artist_slug: "fugazi",
  play_count: 6,
  complete_play_count: 5,
  minutes_listened: 18,
};

const artist = {
  artist_id: 3,
  artist_name: "Fugazi",
  artist_slug: "fugazi",
  play_count: 8,
  complete_play_count: 7,
  minutes_listened: 42,
};

describe("Stats collection panels", () => {
  it("exposes the track action menu on top tracks", () => {
    renderTopTracks();

    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
  });

  it("exposes the album action menu on top albums", () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[album]} loading={false} />,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
  });

  it("lays out top albums with the canonical album grid density", () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[album]} loading={false} />,
    );

    expect(screen.getByTestId("media-grid")).toHaveAttribute(
      "data-density",
      "default",
    );
  });

  it("ranks top listeners with a profile link and their listening time", () => {
    renderWithListenProviders(
      <TopListenersPanel
        listeners={[
          {
            user_id: 3,
            username: "jane",
            display_name: "Jane Doe",
            avatar: null,
            minutes: 125,
            plays: 30,
            active_days: 9,
          },
          {
            user_id: 4,
            username: null,
            display_name: "No Profile",
            avatar: null,
            minutes: 60,
            plays: 1,
            active_days: 1,
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Jane Doe/ })).toHaveAttribute(
      "href",
      "/users/jane",
    );
    expect(screen.getByText("2h 5m · 30 plays")).toBeInTheDocument();
    expect(screen.getByText("1h · 1 play")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /No Profile/ })).toBeNull();
  });

  it("hides albums that would leave an incomplete row at each breakpoint", () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      ...album,
      album_id: index + 1,
      album: `Album ${index + 1}`,
    }));
    renderWithListenProviders(<TopAlbumsPanel items={items} loading={false} />);

    const cells = Array.from(screen.getByTestId("media-grid").children);
    expect(cells).toHaveLength(14);
    expect(cells[9]).not.toHaveAttribute("class");
    expect(cells[10]).toHaveClass("lg:hidden", "xl:block");
    expect(cells[13]).toHaveClass("sm:hidden", "2xl:block");
  });

  it("uses the singular play label for a single play", () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[{ ...album, play_count: 1 }]} loading={false} />,
      { locale: "es" },
    );

    expect(screen.getByText(/1 reproducción\b/)).toBeInTheDocument();
    expect(screen.queryByText(/1 reproducciones/)).toBeNull();
  });

  it("exposes the artist action menu on top artists", () => {
    renderWithListenProviders(
      <TopArtistsPanel items={[artist]} loading={false} />,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
  });

  it("opens the standard track menu from a top track", async () => {
    renderTopTracks();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Play now")).toBeInTheDocument();
  });

  it("opens the standard album menu from a top album", async () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[album]} loading={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Play album")).toBeInTheDocument();
  });

  it("renders top tracks with the canonical row, rank and play meta", () => {
    renderTopTracks();

    const row = screen.getByRole("row", { name: "Waiting Room" });
    expect(row).toHaveClass("track-row");
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(within(row).getByText(/6 plays/)).toBeInTheDocument();
  });

  it("plays the top tracks list from the clicked position", () => {
    const playAll = vi.fn();
    renderTopTracks([track, secondTrack], { playerActions: { playAll } });

    fireEvent.click(screen.getByRole("row", { name: "Suggestion" }));

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Waiting Room" }),
        expect.objectContaining({ title: "Suggestion" }),
      ],
      1,
      playSource,
    );
  });

  it("skips unplayable top tracks in the queue and keeps the clicked position", () => {
    const playAll = vi.fn();
    const unplayable: StatsTrack = {
      ...track,
      track_id: null,
      track_path: null,
      title: "Lost Demo",
    };
    renderTopTracks([unplayable, track, secondTrack], {
      playerActions: { playAll },
    });

    expect(statsTrackRowData(unplayable).id).toBe("Fugazi-Lost Demo");

    fireEvent.click(screen.getByRole("row", { name: "Suggestion" }));

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Waiting Room" }),
        expect.objectContaining({ title: "Suggestion" }),
      ],
      1,
      playSource,
    );
  });

  it("toggles playback when the clicked top track is already playing", () => {
    const pause = vi.fn();
    const playAll = vi.fn();
    renderTopTracks([track, secondTrack], {
      playerActions: {
        playAll,
        pause,
        currentTrack: toPlayableTrack(statsTrackRowData(track)),
      },
      playerState: { isPlaying: true },
    });

    fireEvent.click(screen.getByRole("row", { name: "Waiting Room" }));

    expect(pause).toHaveBeenCalled();
    expect(playAll).not.toHaveBeenCalled();
  });

  it("opens the track menu from a top track with right click", async () => {
    renderTopTracks();

    fireEvent.contextMenu(screen.getByRole("row", { name: "Waiting Room" }));

    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });

  it("opens the track menu from a top track with the menu key", async () => {
    renderTopTracks();

    pressMenuKey(screen.getByRole("row", { name: "Waiting Room" }));

    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });

  it("opens the track action sheet from a top track with a touch long-press", async () => {
    renderTopTracks();

    await longPress(screen.getByRole("row", { name: "Waiting Room" }));

    const sheet = await screen.findByRole("dialog", { name: "Actions menu" });
    expect(within(sheet).getByText("Play now")).toBeInTheDocument();
  });

  it("opens the album menu from a top album with right click and shows rank and meta", async () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[album]} loading={false} />,
    );

    const card = screen.getByText("13 Songs").closest("article")!;
    expect(within(card).getByText(/6 plays/)).toBeInTheDocument();
    fireEvent.contextMenu(card);

    expect(await screen.findByText("Play album")).toBeInTheDocument();
  });

  it("opens the album action sheet from a top album with a touch long-press", async () => {
    renderWithListenProviders(
      <TopAlbumsPanel items={[album]} loading={false} />,
    );

    await longPress(screen.getByText("13 Songs").closest("article")!);

    const sheet = await screen.findByRole("dialog", { name: "Actions menu" });
    expect(within(sheet).getByText("Play album")).toBeInTheDocument();
  });

  it("opens the artist menu from a top artist with right click", async () => {
    renderWithListenProviders(
      <TopArtistsPanel items={[artist]} loading={false} />,
    );

    const card = screen.getByText("Fugazi").closest("article")!;
    fireEvent.contextMenu(card);
    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
  });

  it("computes artist menu entries only when the menu opens", async () => {
    vi.mocked(useArtistActionEntries).mockClear();
    renderWithListenProviders(
      <TopArtistsPanel items={[artist]} loading={false} />,
    );

    expect(useArtistActionEntries).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(useArtistActionEntries).toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
