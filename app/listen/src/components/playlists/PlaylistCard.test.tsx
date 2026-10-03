import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { pressMenuKey } from "@/test/item-action-gestures";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlaylistCard", () => {
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

    screen.getByRole("button", { name: /Crate Selects/ }).focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();

    const playButton = container.querySelector<HTMLButtonElement>(
      "button.bg-accent-action",
    )!;
    playButton.focus();
    await user.keyboard("{Enter}");
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("opens the playlist menu from context menu and the menu key", async () => {
    const { unmount } = renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
    );

    fireEvent.contextMenu(
      screen.getByText("Crate Selects").closest("article")!,
    );
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    unmount();

    renderWithListenProviders(
      <PlaylistCard
        playlistId={7}
        name="Crate Selects"
        meta="12 tracks"
        onClick={vi.fn()}
      />,
    );
    pressMenuKey(screen.getByRole("button", { name: /Crate Selects/ }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});
