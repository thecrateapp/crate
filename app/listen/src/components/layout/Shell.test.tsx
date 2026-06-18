import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Shell } from "./Shell";

const viewportState = vi.hoisted(() => ({ isDesktop: false }));

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => viewportState.isDesktop,
}));

vi.mock("@/components/player/PlayerBar", () => ({
  PlayerBar: () => null,
}));

vi.mock("@/components/layout/TopBar", () => ({
  TopBar: ({ hideMobileActions }: { hideMobileActions?: boolean }) => (
    <div
      data-testid="topbar"
      data-hide-mobile-actions={String(Boolean(hideMobileActions))}
    />
  ),
}));

vi.mock("@/hooks/use-audio-visualizer", () => ({
  useAudioVisualizer: () => ({ frequenciesDb: [] }),
}));

describe("Shell", () => {
  beforeEach(() => {
    viewportState.isDesktop = false;
  });

  it("uses Collection as the mobile library destination label", () => {
    renderWithListenProviders(<Shell />);

    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open queue" })).toBeNull();
  });

  it("renders one unified glass backdrop for the mobile dock when a track is loaded", () => {
    const { container } = renderWithListenProviders(<Shell />, {
      playerActions: {
        currentTrack: {
          id: "track-1",
          title: "Loaded Track",
          artist: "Crate",
        },
      },
    });

    const dockBackdrop = container.querySelector(".listen-mobile-dock-glass");
    const nav = screen.getByRole("navigation");

    expect(dockBackdrop).toBeInTheDocument();
    expect(dockBackdrop).toHaveClass("listen-glass-panel");
    expect(nav).toHaveClass("bg-transparent");
  });

  it("opens a mobile Collection sheet with all collection sections", () => {
    renderWithListenProviders(<Shell />);

    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Collection" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Playlists/i })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Artists/i })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Albums/i })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /Liked tracks/i }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Bandcamp/i })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /Contributions/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /Playlists/i }),
    ).not.toHaveClass("rounded-2xl");
  });

  it("uses the overlay mobile header on public genre pages", () => {
    renderWithListenProviders(<Shell />, { route: "/explore?genre=hardcore" });

    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "true",
    );
  });

  it("uses the overlay mobile header on playlist detail pages", () => {
    renderWithListenProviders(<Shell />, { route: "/playlist/42" });

    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "true",
    );
  });

  it("hides topbar actions on desktop overlay pages", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />, { route: "/explore?genre=hardcore" });

    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "true",
    );
  });
});
