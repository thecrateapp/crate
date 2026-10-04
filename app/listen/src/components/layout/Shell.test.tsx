import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Link, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Shell } from "./Shell";
import { useTransparentHeader } from "./transparent-header";
import { HEADER_SOLID_SCROLL_THRESHOLD } from "./use-scrolled-past";

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

function HeroPage({ enabled = true }: { enabled?: boolean }) {
  useTransparentHeader(enabled);
  return <div data-testid="hero-page" />;
}

function setWindowScroll(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

function scrollWindowTo(y: number) {
  setWindowScroll(y);
  fireEvent.scroll(window);
}

describe("Shell", () => {
  beforeEach(() => {
    viewportState.isDesktop = false;
    setWindowScroll(0);
  });

  afterEach(() => {
    setWindowScroll(0);
  });

  it("uses Collection as the mobile library destination label", () => {
    renderWithListenProviders(<Shell />);

    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open queue" })).toBeNull();
  });

  it("localizes the mobile navigation labels", () => {
    renderWithListenProviders(<Shell />, { locale: "es" });

    expect(screen.getByText("Inicio")).toBeInTheDocument();
    expect(screen.getByText("Explorar")).toBeInTheDocument();
    expect(screen.getByText("Colección")).toBeInTheDocument();
    expect(screen.getByText("Radar")).toBeInTheDocument();
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
    expect(screen.getByRole("menuitem", { name: /Crates/i })).toBeVisible();
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

  it("orders the mobile Collection sections consistently", () => {
    renderWithListenProviders(<Shell />);

    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Artists",
      "Crates",
      "Playlists",
      "Albums",
      "Liked tracks",
      "Bandcamp",
      "Contributions",
    ]);
  });

  it("keeps Crates in the desktop Collection menu", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    expect(screen.getByRole("button", { name: /Crates/i })).toBeVisible();
  });

  it("uses a transparent mobile header when the page declares a hero", () => {
    renderWithListenProviders(
      <Shell>
        <HeroPage />
      </Shell>,
      { route: "/playlist/42" },
    );

    const header = screen.getByTestId("listen-header");
    expect(header).toHaveClass("bg-transparent");
    expect(header).toHaveAttribute("data-transparent", "true");
    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "true",
    );
    expect(screen.getByTestId("listen-content")).toHaveClass("pt-0");
  });

  it("uses a transparent desktop header with scrim when the page declares a hero", () => {
    viewportState.isDesktop = true;

    const { container } = renderWithListenProviders(
      <Shell>
        <HeroPage />
      </Shell>,
      { route: "/explore?genre=hardcore" },
    );

    expect(screen.getByTestId("listen-header")).toHaveClass("bg-transparent");
    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "false",
    );
    expect(
      container.querySelector(".listen-home-top-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("listen-content")).toHaveClass("pt-0");
  });

  it("keeps a solid header on hero-like routes when the page does not declare it", () => {
    viewportState.isDesktop = true;

    const { container } = renderWithListenProviders(
      <Shell>
        <HeroPage enabled={false} />
      </Shell>,
      { route: "/playlist/42" },
    );

    const header = screen.getByTestId("listen-header");
    expect(header).toHaveAttribute("data-transparent", "false");
    expect(header).toHaveClass("bg-surface-chrome", "shadow-chrome");
    expect(header).not.toHaveClass("bg-transparent");
    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "false",
    );
    expect(container.querySelector(".listen-home-top-scrim")).toBeNull();
    expect(screen.getByTestId("listen-content")).toHaveClass("pt-24");
  });

  it("solidifies the transparent header after scrolling past the threshold", async () => {
    viewportState.isDesktop = true;

    const { container } = renderWithListenProviders(
      <Shell>
        <HeroPage />
      </Shell>,
      { route: "/playlist/42" },
    );
    const header = screen.getByTestId("listen-header");

    scrollWindowTo(HEADER_SOLID_SCROLL_THRESHOLD - 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(header).toHaveAttribute("data-transparent", "true");

    scrollWindowTo(HEADER_SOLID_SCROLL_THRESHOLD + 1);
    await waitFor(() =>
      expect(header).toHaveAttribute("data-transparent", "false"),
    );
    expect(header).toHaveClass("bg-surface-chrome");
    expect(container.querySelector(".listen-home-top-scrim")).toBeNull();
    expect(screen.getByTestId("listen-content")).toHaveClass("pt-0");

    scrollWindowTo(0);
    await waitFor(() =>
      expect(header).toHaveAttribute("data-transparent", "true"),
    );
  });

  it("resets the header when navigating away from a hero page", async () => {
    renderWithListenProviders(
      <Shell>
        <Routes>
          <Route
            path="/playlist/:id"
            element={
              <>
                <HeroPage />
                <Link to="/stats">Go to plain page</Link>
                <Link to="/playlist/7">Go to next hero</Link>
              </>
            }
          />
          <Route
            path="/stats"
            element={<Link to="/playlist/9">Back to hero</Link>}
          />
        </Routes>
      </Shell>,
      { route: "/playlist/42" },
    );
    const header = () => screen.getByTestId("listen-header");

    scrollWindowTo(HEADER_SOLID_SCROLL_THRESHOLD + 50);
    await waitFor(() =>
      expect(header()).toHaveAttribute("data-transparent", "false"),
    );

    setWindowScroll(0);
    fireEvent.click(screen.getByRole("link", { name: "Go to next hero" }));
    expect(header()).toHaveAttribute("data-transparent", "true");

    fireEvent.click(screen.getByRole("link", { name: "Go to plain page" }));
    expect(header()).toHaveAttribute("data-transparent", "false");
    expect(header()).toHaveClass("bg-surface-chrome");
    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "false",
    );

    fireEvent.click(screen.getByRole("link", { name: "Back to hero" }));
    expect(header()).toHaveAttribute("data-transparent", "true");
    expect(header()).toHaveClass("bg-transparent");
  });

  it("overlays a transparent scrim header on desktop Home without hiding actions", () => {
    viewportState.isDesktop = true;

    const { container } = renderWithListenProviders(<Shell />, { route: "/" });

    expect(screen.getByTestId("topbar")).toHaveAttribute(
      "data-hide-mobile-actions",
      "false",
    );
    expect(screen.getByTestId("listen-header")).toHaveAttribute(
      "data-home-overlay",
      "true",
    );
    expect(
      container.querySelector(".listen-home-top-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("listen-content")).toHaveClass(
      "max-w-[1480px]",
      "px-0",
      "pt-0",
    );
  });

  it("uses the same 1480px desktop viewport on regular pages", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />, { route: "/artists/7/converge" });

    expect(screen.getByTestId("listen-content")).toHaveClass(
      "max-w-[1480px]",
      "px-6",
    );
    expect(screen.getByTestId("listen-content")).not.toHaveClass(
      "max-w-[1560px]",
      "px-10",
    );
  });

  it("uses semantic tokens for desktop shell surfaces and navigation", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />, { route: "/stats" });

    expect(screen.getByRole("complementary")).toHaveClass(
      "border-border-quiet",
      "bg-surface-canvas",
    );
    expect(screen.getByTestId("listen-header")).toHaveClass(
      "border-border-quiet",
      "bg-surface-chrome",
      "shadow-chrome",
    );
    expect(screen.getByRole("link", { name: "Stats" })).toHaveClass(
      "text-accent-action",
    );
  });

  it("keeps the discovery-active brand label on the accent token", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />, {
      playerState: { isPlaying: true },
      playerActions: {
        currentTrack: {
          id: "discovery-track",
          title: "Discovery track",
          artist: "Crate",
        },
        playSource: {
          type: "radio",
          name: "Discovery Radio",
          radio: { seedType: "discovery" },
        },
      },
    });

    const brandLabel = screen
      .getAllByText("Crate")
      .find((element) => element.tagName === "SPAN");

    expect(brandLabel).toHaveClass("text-accent-action");
    expect(brandLabel).not.toHaveClass("text-text-primary");
  });

  it("keeps the inactive brand label on the primary text token", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />);

    const brandLabel = screen
      .getAllByText("Crate")
      .find((element) => element.tagName === "SPAN");

    expect(brandLabel).toHaveClass("text-text-primary");
  });

  it("overlays the mobile Home header on the hero", () => {
    const { container } = renderWithListenProviders(<Shell />, { route: "/" });

    expect(screen.getByTestId("listen-header")).toHaveAttribute(
      "data-home-overlay",
      "true",
    );
    expect(container.querySelector(".listen-home-top-scrim")).toBeNull();
    expect(screen.getByTestId("listen-content")).toHaveClass("pt-0");
  });
});
