import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  it("uses uppercase MonoLabel for primary and Collection sidebar destinations", () => {
    viewportState.isDesktop = true;
    renderWithListenProviders(<Shell />, { route: "/library?tab=artists" });
    const nav = screen.getByRole("navigation", { name: "Collection" });
    for (const label of ["Music", "Artists", "Albums", "Collection"]) {
      expect(within(nav).getByText(label)).toHaveClass(
        "crate-mono-label",
        "uppercase",
        "font-mono",
        "text-inherit",
      );
    }
  });
  it("uses the same navigation item recipe for Collection children and first-level destinations", async () => {
    viewportState.isDesktop = true;
    renderWithListenProviders(<Shell />, { route: "/library?tab=artists" });
    const nav = screen.getByRole("navigation", { name: "Collection" });
    expect(within(nav).getByRole("link", { name: "Artists" })).toBeVisible();
    await userEvent.click(
      within(nav).getByRole("button", { name: "Collection" }),
    );
    expect(within(nav).getByRole("link", { name: "Artists" })).toHaveClass(
      "listen-nav-item",
    );
    expect(within(nav).getByRole("link", { name: "Music" })).toHaveClass(
      "listen-nav-item",
    );
    expect(
      within(nav).getByRole("button", { name: "Collection" }),
    ).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(within(nav).getByRole("link", { name: "Albums" }));
    expect(within(nav).getByRole("link", { name: "Artists" })).toBeVisible();
    await userEvent.click(within(nav).getByRole("link", { name: "Music" }));
    expect(
      within(nav).queryByRole("link", { name: "Artists" }),
    ).not.toBeInTheDocument();
  });
  it("adds the ordinary header hairline after scrolling", async () => {
    viewportState.isDesktop = true;
    renderWithListenProviders(<Shell />, { route: "/library" });
    expect(screen.getByTestId("listen-header")).not.toHaveClass(
      "border-border-quiet",
    );
    scrollWindowTo(HEADER_SOLID_SCROLL_THRESHOLD + 1);
    await waitFor(() =>
      expect(screen.getByTestId("listen-header")).toHaveClass(
        "border-border-quiet",
      ),
    );
  });
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

  it("renders one unified frosted backdrop for the mobile dock when a track is loaded", () => {
    const { container } = renderWithListenProviders(<Shell />, {
      playerActions: {
        currentTrack: {
          id: "track-1",
          title: "Loaded Track",
          artist: "Crate",
        },
      },
    });

    const dockBackdrop = container.querySelector(".listen-mobile-dock-surface");
    const nav = screen.getByRole("navigation");

    expect(dockBackdrop).toBeInTheDocument();
    expect(dockBackdrop).toHaveClass(
      "listen-mobile-dock-glass",
      "border-border-quiet",
    );
    expect(dockBackdrop).not.toHaveClass("listen-glass-panel");
    expect(dockBackdrop?.className).not.toMatch(/accent|glow|gradient/);
    expect(nav).toHaveClass("bg-transparent");
    const labels = nav.querySelectorAll(".listen-mobile-nav-item > span");
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toHaveClass("crate-mono-label", "uppercase");
    }
  });

  it("opens a mobile Collection sheet with all collection sections", () => {
    renderWithListenProviders(<Shell />);

    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Collection" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Playlists/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Artists/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Albums/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Crates/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Liked tracks/i })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Bandcamp/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Contributions/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Playlists/i })).not.toHaveClass(
      "rounded-2xl",
    );
  });

  it("orders the mobile Collection sections consistently", () => {
    renderWithListenProviders(<Shell />);

    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    const items = screen
      .getAllByRole("link")
      .filter((el) => el.closest('[role="dialog"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Artists",
      "Crates",
      "Playlists",
      "Albums",
      "Liked tracks",
      "Contributions",
    ]);
  });

  it("keeps Crates in the desktop Collection menu", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Collection" }));

    expect(screen.getByRole("link", { name: /Crates/i })).toBeVisible();
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
    expect(header).toHaveClass("bg-surface-chrome");
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

  it("solidifies the transparent header when the root scroll container scrolls", async () => {
    viewportState.isDesktop = true;
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    document.documentElement.dataset.crateLinuxWindowChrome = "true";

    try {
      renderWithListenProviders(
        <Shell>
          <HeroPage />
        </Shell>,
        { route: "/playlist/42" },
      );
      const header = screen.getByTestId("listen-header");
      expect(header).toHaveAttribute("data-transparent", "true");

      scrollWindowTo(HEADER_SOLID_SCROLL_THRESHOLD + 50);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(header).toHaveAttribute("data-transparent", "true");

      root.scrollTop = HEADER_SOLID_SCROLL_THRESHOLD + 1;
      fireEvent.scroll(root);
      await waitFor(() =>
        expect(header).toHaveAttribute("data-transparent", "false"),
      );

      root.scrollTop = 0;
      fireEvent.scroll(root);
      await waitFor(() =>
        expect(header).toHaveAttribute("data-transparent", "true"),
      );
    } finally {
      delete document.documentElement.dataset.crateLinuxWindowChrome;
      root.remove();
    }
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
      "max-w-content",
      "px-0",
      "pt-0",
    );
  });

  it("uses the same 1480px desktop viewport on regular pages", () => {
    viewportState.isDesktop = true;

    renderWithListenProviders(<Shell />, { route: "/artists/7/converge" });

    expect(screen.getByTestId("listen-content")).toHaveClass(
      "max-w-content",
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
      "border-transparent",
      "bg-surface-chrome",
    );
    expect(screen.getByRole("link", { name: "Stats" })).toHaveClass(
      "listen-nav-item",
    );
  });

  it("keeps the brand stable during discovery playback", () => {
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

    expect(brandLabel).toHaveClass("text-text-primary");
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

it.each([false, true])(
  "keeps skip navigation first and focuses main on desktop=%s",
  async (isDesktop) => {
    viewportState.isDesktop = isDesktop;
    const user = userEvent.setup();
    renderWithListenProviders(
      <Shell>
        <button type="button">First content action</button>
      </Shell>,
      { route: "/library?tab=albums#details" },
    );
    const link = screen.getByRole("link", { name: "Skip to main content" });
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(link).toHaveAttribute("href", `#${main.id}`);
    await user.tab();
    expect(link).toHaveFocus();
    const url = window.location.href;
    await user.keyboard("{Enter}");
    expect(main).toHaveFocus();
    expect(window.location.href).toBe(url);
    await user.tab();
    expect(
      screen.getByRole("button", { name: "First content action" }),
    ).toHaveFocus();
  },
);

it.each([
  ["en", "Skip to main content"],
  ["es", "Saltar al contenido principal"],
  ["fr", "Aller au contenu principal"],
  ["de", "Zum Hauptinhalt springen"],
  ["it", "Vai al contenuto principale"],
  ["ca", "Ves al contingut principal"],
  ["eu", "Joan eduki nagusira"],
] as const)("localizes skip navigation in %s", (locale, label) => {
  viewportState.isDesktop = false;
  renderWithListenProviders(<Shell />, { locale });
  expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
});
