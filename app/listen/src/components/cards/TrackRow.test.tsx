import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
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
    await user.click(screen.getByText("Track One"));

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
    fireEvent.click(screen.getByRole("button", { name: "Play next" }));

    expect(playNext).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));

    expect(addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();
  });
});
