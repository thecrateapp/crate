import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FullscreenPlayerLyricsTab,
  FullscreenPlayerQueueTab,
} from "@/components/player/FullscreenPlayerTabs";
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

it("uses the shared retryable lyrics content on the fullscreen renderer", () => {
  const retry = vi.fn();
  renderWithListenProviders(
    <FullscreenPlayerLyricsTab
      lyrics={null}
      lyricsLoading={false}
      lyricsError
      onRetryLyrics={retry}
      refs={{ lyricsContainerRef: { current: null } } as never}
      activeLyricIndex={-1}
      seek={vi.fn()}
      t={((key: string) => key) as never}
      scrollTabBottomClearance="32px"
    />,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
});
