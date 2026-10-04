import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import type { ReactElement } from "react";
import { Pencil } from "@crate/ui/icons";

import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const api = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api,
}));

function renderWithRoutes(element: ReactElement, options = {}) {
  return renderWithListenProviders(
    <Routes>
      <Route path="/" element={element} />
      <Route path="/playlist/:id" element={<p>Playlist page</p>} />
    </Routes>,
    options,
  );
}

describe("PlaylistCard tile", () => {
  it("uses the semantic canvas token for playlist badges", () => {
    renderWithListenProviders(
      <PlaylistCard
        name="Crate Selects"
        meta="12 tracks"
        badge="Featured"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Featured")).toHaveClass("bg-surface-canvas/85");
  });

  it("navigates from the primary button and keeps nested controls independent", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onPlay = vi.fn();
    const { container } = renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={onClick}
        onPlay={onPlay}
      />,
    );

    expect(container.querySelector("[role='button']")).toBeNull();

    const primary = screen.getByRole("button", { name: "Open Crate Selects" });
    primary.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();

    const playButton = screen.getByRole("button", {
      name: "Play Crate Selects",
    });
    expect(primary.contains(playButton)).toBe(false);
    playButton.focus();
    await user.keyboard("{Enter}");
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the menu button and opens the playlist menu from it, context menu and the menu key", async () => {
    const { unmount } = renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    unmount();

    const second = renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    second.unmount();

    renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
    );
    pressMenuKey(screen.getByRole("button", { name: "Open Crate Selects" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("follows system playlists from the overlay and the menu", async () => {
    const onToggleFollow = vi.fn();
    renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        systemPlaylist
        crateManaged
        onClick={vi.fn()}
        onToggleFollow={onToggleFollow}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add to your library" }),
    );
    await waitFor(() => expect(onToggleFollow).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Add to your library" }),
    );
    await waitFor(() => expect(onToggleFollow).toHaveBeenCalledTimes(2));
  });

  it("shows the offline badge and progress for downloaded playlists", () => {
    renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
      {
        offline: {
          getPlaylistState: () => "downloading",
          getPlaylistRecord: () =>
            ({ trackCount: 12, readyTrackCount: 5 }) as never,
        },
      },
    );

    expect(screen.getByText("· 5/12 offline")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveClass("bg-accent-action/[0.05]");
  });
});

describe("PlaylistCard featured", () => {
  it("renders the generated playlist summary with play and menu controls", async () => {
    const onClick = vi.fn();
    const onPlay = vi.fn();
    renderWithListenProviders(
      <PlaylistCard
        variant="featured"
        name="Daily Mix 1"
        summary="Birds In Row, High Vis"
        meta="25 tracks"
        href="/home/playlist/daily-1"
        renderArtwork={(className) => (
          <div data-testid="mix-artwork" className={className} />
        )}
        onClick={onClick}
        onPlay={onPlay}
        onShuffle={vi.fn()}
        onStartRadio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("mix-artwork")).toHaveClass("rounded-xl");
    expect(screen.getByText("Birds In Row, High Vis")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open Daily Mix 1" }));
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Play Daily Mix 1" }));
    await waitFor(() => expect(onPlay).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Start playlist radio" }),
    ).toBeInTheDocument();
  });

  it("keeps an accessible title when only the artwork is shown", () => {
    renderWithListenProviders(
      <PlaylistCard
        variant="featured"
        name="Core: High Vis"
        meta="20 tracks"
        artworkOnly
        renderArtwork={(className) => <div className={className} />}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Core: High Vis")).toHaveClass("sr-only");
    expect(screen.queryByText("20 tracks")).toBeNull();
  });
});

describe("PlaylistCard row", () => {
  function renderRow(options = {}) {
    return renderWithRoutes(
      <PlaylistCard
        variant="row"
        playlistId={9}
        name="Night Drive"
        trackCount={12}
        href="/playlist/9"
        detailEndpoint="/api/playlists/9"
      />,
      options,
    );
  }

  it("navigates from the primary link", async () => {
    const user = userEvent.setup();
    renderRow();

    const link = screen.getByRole("link", { name: "Open Night Drive" });
    expect(link).toHaveAttribute("href", "/playlist/9");
    link.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Playlist page")).toBeInTheDocument();
  });

  it("opens the menu with Enter on the menu button without navigating", async () => {
    const user = userEvent.setup();
    const { container } = renderRow();

    expect(container.querySelector("[role='button']")).toBeNull();
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Playlist page")).toBeNull();
  });

  it("opens the menu with right click and the menu key", async () => {
    const first = renderRow();
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    first.unmount();

    renderRow();
    pressMenuKey(screen.getByRole("link", { name: "Open Night Drive" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("opens the action sheet with a touch long-press without navigating", async () => {
    renderRow();

    await longPress(screen.getByRole("article"));
    fireEvent.click(screen.getByRole("link", { name: "Open Night Drive" }));

    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Playlist page")).toBeNull();
  });

  it("loads and plays the playlist from the inline play button", async () => {
    const playAll = vi.fn();
    api.mockResolvedValueOnce({
      tracks: [
        {
          track_id: 1,
          track_path: "/music/a.flac",
          title: "A",
          artist: "Birds In Row",
          album: "Gris Klein",
          duration: 120,
        },
      ],
    });
    renderRow({ playerActions: { playAll } });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => expect(playAll).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/api/playlists/9");
  });

  it("appends extra actions to the inline controls and the menu", async () => {
    const onEdit = vi.fn();
    renderWithListenProviders(
      <PlaylistCard
        variant="row"
        playlistId={9}
        name="Night Drive"
        trackCount={12}
        href="/playlist/9"
        badge="Smart"
        extraActions={[
          { key: "edit", icon: Pencil, title: "Edit", onClick: onEdit },
        ]}
      />,
    );

    expect(screen.getByText("Smart")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(2);
  });
});
