import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { toTrackRowData } from "@/lib/track-row-data";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const navigateMock = vi.hoisted(() => vi.fn());
const toggleTrackLikeMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/components/actions/track-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/actions/track-actions")>();
  return {
    ...actual,
    useTrackActionEntries: vi.fn(actual.useTrackActionEntries),
  };
});

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: toggleTrackLikeMock,
  }),
}));

describe("TrackRow playback behavior", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    toggleTrackLikeMock.mockReset();
  });

  it("preserves quality metadata when playback starts from a row queue", async () => {
    const playAll = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        album_id: 12,
        format: "flac",
        bitrate: 1411,
        sample_rate: 44100,
        bit_depth: 16,
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
        album_id: 12,
        format: "aac",
        bitrate: 320,
        sample_rate: 48000,
        bit_depth: null,
      },
    ];
    const firstTrack = tracks[0]!;

    renderWithListenProviders(
      <TrackRow track={firstTrack} queueTracks={tracks} />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    const user = userEvent.setup();
    await user.click(screen.getAllByText("Track One")[0]!);

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "entity-1",
          entityUid: "entity-1",
          format: "flac",
          bitrate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        }),
        expect.objectContaining({
          id: "entity-2",
          entityUid: "entity-2",
          format: "aac",
          bitrate: 320,
          sampleRate: 48000,
          bitDepth: null,
        }),
      ],
      0,
    );
  });

  it("animates the heart when adding a track to the collection", async () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(<TrackRow track={track} />);

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Like track"));

    expect(screen.getByTestId("track-like-particles")).toBeInTheDocument();
    expect(screen.getByTestId("track-like-heart")).toHaveClass(
      "crate-follow-heart-in",
    );
    expect(toggleTrackLikeMock).toHaveBeenCalledWith(
      1,
      "entity-1",
      "",
      undefined,
    );
  });

  it("does not activate the row when selecting queue actions from the menu", async () => {
    const playAll = vi.fn();
    const playNext = vi.fn();
    const addToQueue = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        album_id: 12,
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
        album_id: 12,
      },
    ];

    renderWithListenProviders(
      <TrackRow track={tracks[0]!} queueTracks={tracks} />,
      {
        playerActions: {
          playAll,
          playNext,
          addToQueue,
        },
      },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play next" }));

    expect(playNext).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to queue" }));

    expect(addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();
  });

  it("includes playlist actions when the row does not provide playlist callbacks", async () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(<TrackRow track={track} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Add to playlist" }));

    expect(
      screen.getByRole("menuitem", { name: "Add to new playlist" }),
    ).toBeVisible();
  });

  it("opens the normal track menu on right click without selecting the row", () => {
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow track={track} selectable onSelect={onSelect} />,
    );

    fireEvent.contextMenu(screen.getByText("Track One"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects instead of playing on single click when selectable", async () => {
    const playAll = vi.fn();
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };
    const nextTrack: TrackRowData = {
      id: 2,
      entity_uid: "entity-2",
      title: "Track Two",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track, nextTrack]}
        selectable
        onSelect={onSelect}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(screen.getByText("Track One"));

    expect(onSelect).toHaveBeenCalledWith(track, expect.any(Object));
    expect(playAll).not.toHaveBeenCalled();
  });

  it("plays from the leading play control when selectable", async () => {
    const playAll = vi.fn();
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };
    const nextTrack: TrackRowData = {
      id: 2,
      entity_uid: "entity-2",
      title: "Track Two",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track, nextTrack]}
        selectable
        onSelect={onSelect}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Play Track One" }),
    );

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      0,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("plays from the row on double click when selectable", () => {
    const playAll = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
      },
    ];

    renderWithListenProviders(
      <TrackRow track={tracks[0]!} queueTracks={tracks} selectable />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    fireEvent.doubleClick(screen.getByText("Track One"));

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      0,
    );
  });

  it("uses selection actions from the row menu button when selected", async () => {
    const playAll = vi.fn();
    const onSelectionActionMenuOpen = vi.fn(() => true);
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track]}
        selectable
        selected
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(onSelectionActionMenuOpen).toHaveBeenCalledWith(
      track,
      expect.any(Object),
    );
    expect(playAll).not.toHaveBeenCalled();
  });

  it("opens the track menu instead of selecting on right click", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(<TrackRow track={track} selectable />);

    fireEvent.contextMenu(screen.getByText("Track One"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("keeps circular progress and global play glow on the active playing row", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    const { container } = renderWithListenProviders(
      <TrackRow track={track} />,
      {
        playerActions: {
          currentTrack: {
            id: "entity-1",
            entityUid: "entity-1",
            title: "Track One",
            artist: "Artist",
          },
        },
        playerProgress: {
          currentTime: 30,
          duration: 120,
        },
        playerState: {
          isPlaying: true,
        },
      },
    );

    const progress = screen.getByTestId("track-row-playback-progress");

    expect(progress.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(progress.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(progress.innerHTML).toContain("animate-crate-play-core-pulse");
    expect(progress.className).not.toContain("conic-gradient");
    expect(progress.innerHTML).not.toContain("conic-gradient");
    expect(container.innerHTML).toContain("stroke-dashoffset");
  });

  it("hides the track number on the active row and keeps it on the others", () => {
    const playerActions = {
      currentTrack: {
        id: "entity-1",
        entityUid: "entity-1",
        title: "Track One",
        artist: "Artist",
      },
    };

    renderWithListenProviders(
      <>
        <TrackRow
          track={{
            id: 1,
            entity_uid: "entity-1",
            title: "Track One",
            artist: "Artist",
          }}
          index={1}
        />
        <TrackRow
          track={{
            id: 2,
            entity_uid: "entity-2",
            title: "Track Two",
            artist: "Artist",
          }}
          index={2}
        />
      </>,
      { playerActions, playerState: { isPlaying: true } },
    );

    expect(
      screen.getByTestId("track-row-playback-progress"),
    ).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("consumes semantic classes for row states and playback progress", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    const { container } = renderWithListenProviders(
      <TrackRow track={track} showCoverThumb />,
      {
        playerActions: {
          currentTrack: {
            id: "entity-1",
            entityUid: "entity-1",
            title: "Track One",
            artist: "Artist",
          },
        },
        playerState: {
          isPlaying: true,
        },
      },
    );

    expect(container.firstElementChild).toHaveClass("track-row");
    expect(container.firstElementChild).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("track-row-playback-progress")).toHaveClass(
      "track-row-playback-progress",
    );
    expect(
      screen.getByTestId("track-row-playback-progress").firstElementChild,
    ).toHaveClass("track-row-playback-aura");
  });

  it("uses normalized global album artwork for catalog-only rows", () => {
    const track = toTrackRowData({
      id: "track-global-1",
      globalTrackUid: "track-global-1",
      globalAlbumUid: "album-global-1",
      title: "0151",
      artist: "High Vis",
      album: "Blending",
      availability: {
        catalog: true,
        stream: true,
        import: false,
        local: false,
      },
    });

    const { container } = renderWithListenProviders(
      <TrackRow track={track} showCoverThumb />,
    );

    expect(container.innerHTML).toContain(
      "/api/catalog/albums/album-global-1/cover",
    );
  });

  describe("action menu gestures", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
      album_id: 12,
    };

    it("computes menu entries only when the menu opens", async () => {
      vi.mocked(useTrackActionEntries).mockClear();
      renderWithListenProviders(<TrackRow track={track} />);

      expect(useTrackActionEntries).not.toHaveBeenCalled();

      fireEvent.contextMenu(screen.getByRole("row", { name: "Track One" }));

      expect(await screen.findByText("Play now")).toBeInTheDocument();
      expect(useTrackActionEntries).toHaveBeenCalled();
    });

    it("opens the menu with a touch long-press without playing", async () => {
      const play = vi.fn();
      renderWithListenProviders(<TrackRow track={track} />, {
        playerActions: { play },
      });
      const row = screen.getByRole("row", { name: "Track One" });

      await longPress(row);
      fireEvent.click(row);

      expect(
        await screen.findByRole("dialog", { name: "Actions menu" }),
      ).toBeInTheDocument();
      expect(play).not.toHaveBeenCalled();
    });

    it("opens the menu with the ContextMenu key and Shift+F10", async () => {
      const { unmount } = renderWithListenProviders(<TrackRow track={track} />);
      pressMenuKey(screen.getByRole("row", { name: "Track One" }));
      expect(await screen.findByText("Play now")).toBeInTheDocument();
      unmount();

      renderWithListenProviders(<TrackRow track={track} />);
      fireEvent.keyDown(screen.getByRole("row", { name: "Track One" }), {
        key: "F10",
        shiftKey: true,
      });
      expect(await screen.findByText("Play now")).toBeInTheDocument();
    });

    it("does not open the menu on disabled rows", () => {
      renderWithListenProviders(
        <TrackRow track={{ ...track, disabled: true }} />,
      );

      fireEvent.contextMenu(screen.getByRole("row", { name: "Track One" }));

      expect(screen.queryByText("Play now")).not.toBeInTheDocument();
    });

    it("renders rank, meta and extra actions", async () => {
      const onRemove = vi.fn();
      renderWithListenProviders(
        <TrackRow
          track={track}
          rank={3}
          meta="12 plays"
          density="compact"
          showLike={false}
          extraActions={[
            { key: "remove", label: "Remove", onSelect: onRemove },
          ]}
        />,
      );
      const row = screen.getByRole("row", { name: "Track One" });

      expect(row).toHaveAttribute("data-density", "compact");
      expect(within(row).getByText("3")).toBeInTheDocument();
      expect(within(row).getByText("12 plays")).toBeInTheDocument();
      expect(screen.queryByTitle("Like track")).not.toBeInTheDocument();

      fireEvent.contextMenu(row);
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
      expect(onRemove).toHaveBeenCalled();
    });

    it("offers link actions on catalog-only rows", async () => {
      renderWithListenProviders(
        <TrackRow
          track={{
            title: "Remote Track",
            artist: "Artist",
            album: "Album",
            global_track_uid: "global-track-1",
            global_artist_uid: "global-artist-1",
            global_album_uid: "global-album-1",
            availability: {
              catalog: true,
              stream: true,
              import: false,
              local: false,
            },
          }}
        />,
      );

      fireEvent.contextMenu(screen.getByRole("row", { name: "Remote Track" }));

      expect(
        await screen.findByRole("menuitem", { name: "Go to artist" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "Play now" }),
      ).not.toBeInTheDocument();
    });
  });
});
