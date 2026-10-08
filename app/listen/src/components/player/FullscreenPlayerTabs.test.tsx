import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FullscreenPlayerQueueTab } from "@/components/player/FullscreenPlayerTabs";
import type { ViewPlayer } from "@/components/player/fullscreen-player-view-types";
import type { Track } from "@/contexts/PlayerContext";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

const upcoming: Track = {
  id: "next",
  title: "Next Song",
  artist: "High Vis",
  libraryTrackId: 2,
};

describe("FullscreenPlayerQueueTab", () => {
  it("locks queue rows while a Jam room controls the queue", () => {
    renderWithListenProviders(
      <FullscreenPlayerQueueTab
        player={{ upcomingTracks: [upcoming] } as unknown as ViewPlayer}
        t={((key: string) => key) as never}
        jumpTo={vi.fn()}
        locked
        scrollTabBottomClearance="0px"
      />,
    );

    const row = screen.getByTestId("queue-track-row");
    expect(row).toHaveAttribute("inert");
    expect(row).toHaveClass("grayscale");
  });
});
