import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueueTrackRow } from "@/components/player/QueueTrackRow";
import type { Track } from "@/contexts/PlayerContext";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

const track: Track = {
  id: "track-1",
  title: "Repeat Me",
  artist: "High Vis",
  libraryTrackId: 1,
};

describe("QueueTrackRow", () => {
  it("jumps to a duplicate of the current track instead of pausing", () => {
    const onJump = vi.fn();
    const pause = vi.fn();

    renderWithListenProviders(
      <QueueTrackRow track={track} queueIndex={3} onJump={onJump} />,
      {
        playerActions: { currentTrack: track, pause },
        playerState: { isPlaying: true },
      },
    );

    const row = screen.getByRole("row", { name: "Repeat Me" });
    expect(row).toHaveAttribute("data-active", "false");

    fireEvent.click(row);

    expect(onJump).toHaveBeenCalledWith(3);
    expect(pause).not.toHaveBeenCalled();
  });

  it("toggles playback only for the current queue index", () => {
    const onJump = vi.fn();
    const pause = vi.fn();

    renderWithListenProviders(
      <QueueTrackRow track={track} queueIndex={0} onJump={onJump} isCurrent />,
      {
        playerActions: { currentTrack: track, pause },
        playerState: { isPlaying: true },
      },
    );

    const row = screen.getByRole("row", { name: "Repeat Me" });
    expect(row).toHaveAttribute("data-active", "true");

    fireEvent.click(row);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
  });
});
