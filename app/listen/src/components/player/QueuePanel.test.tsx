import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApi = vi.hoisted(() =>
  vi.fn((url: string | null) => ({
    data: url === "/api/playlists" ? [{ id: 7, name: "Favorites" }] : null,
  })),
);

vi.mock("@/hooks/use-api", () => ({ useApi }));

import { QueuePanel } from "@/components/player/QueuePanel";
import { PlaylistComposerProvider } from "@/contexts/PlaylistComposerContext";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { Track } from "@/contexts/PlayerContext";

let isDesktop = false;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(async () => true),
  }),
}));

const currentTrack: Track = {
  id: "track-1",
  title: "Now",
  artist: "Artist",
  album: "Album",
};

const nextTrack: Track = {
  id: "track-2",
  title: "Next",
  artist: "Artist",
  album: "Album",
  albumCover: "/covers/next.jpg",
};

describe("QueuePanel", () => {
  beforeEach(() => {
    isDesktop = false;
    useApi.mockClear();
  });

  it("renders as a mobile bottom sheet on non-desktop viewports", () => {
    renderWithListenProviders(<QueuePanel open onClose={vi.fn()} />, {
      playerActions: {
        currentTrack,
        queue: [currentTrack, nextTrack],
        currentIndex: 0,
      },
    });

    const dialog = screen.getByRole("dialog");
    const panel = dialog.querySelector(".listen-glass-panel");

    expect(dialog).toHaveClass("z-app-modal");
    expect(panel).toHaveStyle({ bottom: "0px" });
    expect(panel).not.toHaveClass("listen-glass-panel--dock");
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("keeps the desktop dock panel on desktop viewports", () => {
    isDesktop = true;

    renderWithListenProviders(<QueuePanel open onClose={vi.fn()} />, {
      playerActions: {
        currentTrack,
        queue: [currentTrack, nextTrack],
        currentIndex: 0,
      },
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText("Queue").closest(".listen-glass-panel"),
    ).toHaveClass("listen-glass-panel--dock");
  });

  it("makes the local queue visibly readonly inside a Jam room", () => {
    renderWithListenProviders(<QueuePanel open onClose={vi.fn()} />, {
      playerActions: {
        currentTrack,
        queue: [currentTrack, nextTrack],
        currentIndex: 0,
        jamQueueLocked: true,
      },
    });

    expect(screen.getByText("Jam room queue")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Playback is controlled by the room while you are connected.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByAltText("")).toHaveClass("grayscale");
    expect(screen.getByText("Next").closest('[role="button"]')).toBeNull();
  });

  it("uses semantic tokens for queue surfaces and track states", () => {
    isDesktop = true;

    renderWithListenProviders(<QueuePanel open onClose={vi.fn()} />, {
      playerActions: {
        currentTrack,
        queue: [currentTrack, nextTrack],
        currentIndex: 0,
      },
    });

    const panel = screen.getByText("Queue").closest(".listen-glass-panel");
    const nextRow = screen.getByText("Next").closest('[role="button"]');

    expect(panel).toHaveClass("border-l", "border-border-quiet");
    expect(screen.getByText("Queue")).toHaveClass("text-text-primary");
    expect(nextRow).toHaveClass(
      "hover:bg-surface-control",
      "focus-visible:bg-surface-control",
      "focus-visible:ring-focus-ring/40",
    );
    expect(screen.getByText("Next")).toHaveClass("text-text-primary");
    expect(nextRow?.className).not.toContain("white/");
  });

  it("loads existing playlists when a queue track menu opens", async () => {
    renderWithListenProviders(
      <PlaylistComposerProvider>
        <QueuePanel open onClose={vi.fn()} />
      </PlaylistComposerProvider>,
      {
        locale: "es",
        playerActions: {
          currentTrack,
          queue: [currentTrack, nextTrack],
          currentIndex: 0,
        },
      },
    );

    expect(useApi).not.toHaveBeenCalledWith("/api/playlists");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    await waitFor(() => {
      expect(useApi).toHaveBeenCalledWith("/api/playlists");
      expect(
        screen.getByRole("menuitem", { name: "Añadir a Favorites" }),
      ).toBeInTheDocument();
    });
  });
});
