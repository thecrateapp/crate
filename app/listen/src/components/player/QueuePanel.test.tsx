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
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
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
    const panel = screen.getByText("Queue").closest(".listen-glass-panel");
    expect(panel).toHaveClass(
      "listen-glass-panel--dock",
      "bottom-(--listen-desktop-player-clearance)",
    );
    expect(screen.getByText("Next").closest(".overflow-y-auto")).toHaveClass(
      "pb-2",
    );
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
    const lockedRow = screen.getAllByTestId("queue-track-row")[0]!;
    expect(lockedRow).toHaveClass("grayscale");
    expect(lockedRow).toHaveAttribute("inert");
    expect(lockedRow).not.toHaveAttribute("aria-disabled");
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
    const nextRow = screen.getByRole("row", { name: "Next" });

    expect(panel).toHaveClass("border-l", "border-border-quiet");
    expect(screen.getByText("Queue")).toHaveClass("text-text-primary");
    expect(nextRow).toHaveClass("track-row");
    expect(nextRow).toHaveAttribute("data-density", "compact");
    expect(screen.getByText("Next")).toHaveClass("text-text-primary");
    expect(nextRow.className).not.toContain("white/");
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
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));

    await waitFor(() => {
      expect(useApi).toHaveBeenCalledWith("/api/playlists");
    });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Añadir a playlist" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("menuitem", { name: "Añadir a Favorites" }),
      ).toBeInTheDocument();
    });
  });

  function renderQueue(playerActions = {}) {
    return renderWithListenProviders(<QueuePanel open onClose={vi.fn()} />, {
      playerActions: {
        currentTrack,
        queue: [currentTrack, nextTrack],
        currentIndex: 0,
        ...playerActions,
      },
    });
  }

  it("jumps to the queue position when a row is clicked", () => {
    const jumpTo = vi.fn();
    renderQueue({ jumpTo });

    fireEvent.click(screen.getByRole("row", { name: "Next" }));

    expect(jumpTo).toHaveBeenCalledWith(1);
  });

  it("opens the queue row menu with right click and removes from the queue", async () => {
    isDesktop = true;
    const removeFromQueue = vi.fn();
    renderQueue({ removeFromQueue });

    fireEvent.contextMenu(screen.getByRole("row", { name: "Next" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove from queue" }),
    );

    expect(removeFromQueue).toHaveBeenCalledWith(1);
  });

  it("opens the queue row menu with the menu key", async () => {
    isDesktop = true;
    renderQueue();

    pressMenuKey(screen.getByRole("row", { name: "Next" }));

    expect(
      await screen.findByRole("menuitem", { name: "Remove from queue" }),
    ).toBeInTheDocument();
  });

  it("opens the queue row action sheet with a touch long-press", async () => {
    renderQueue();

    await longPress(screen.getByRole("row", { name: "Next" }));

    expect(
      await screen.findByRole("menuitem", { name: "Remove from queue" }),
    ).toBeInTheDocument();
  });

  it("hides the remove action while the Jam queue is locked", async () => {
    renderQueue({ jamQueueLocked: true });

    fireEvent.contextMenu(screen.getByRole("row", { name: "Next" }));

    expect(
      await screen.findByRole("menuitem", { name: "Play now" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Remove from queue" }),
    ).not.toBeInTheDocument();
  });
});
