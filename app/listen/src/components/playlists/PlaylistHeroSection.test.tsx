import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Play, Radio, Share2, Shuffle } from "@crate/ui/icons";

import { PlaylistHeroSection } from "./PlaylistHeroSection";

function mockDesktopPointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("min-width: 768px") ||
        query.includes("hover: hover") ||
        query.includes("pointer: fine"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockMobilePointer() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("hover: none") || query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderArtwork(className: string) {
  return (
    <div
      data-testid="playlist-artwork"
      className={className}
      aria-label="Playlist artwork"
    />
  );
}

beforeAll(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

beforeEach(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  mockDesktopPointer();
});

describe("PlaylistHeroSection", () => {
  it("keeps the hero background in the artist/album language without blur", () => {
    const { container } = render(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    expect(container.querySelector('[class*="blur-"]')).not.toBeInTheDocument();
  });

  it("uses an explicit mobile hero height so copy sits directly above CTAs", () => {
    const { container } = render(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const hero = container.firstElementChild as HTMLElement;
    expect(hero).toHaveClass("h-[420px]");
    expect(hero).not.toHaveClass("min-h-[430px]");
  });

  it("uses artist/album-style primary pills and secondary icon labels", () => {
    render(
      <PlaylistHeroSection
        title="Friday Damage"
        description="A playlist for badly lit rooms."
        metaItems={["12 tracks", "42 min"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[
          {
            key: "radio",
            label: "Radio",
            ariaLabel: "Playlist Radio",
            icon: Radio,
            onClick: vi.fn(),
          },
          {
            key: "share",
            label: "Share",
            ariaLabel: "Share",
            icon: Share2,
            onClick: vi.fn(),
          },
        ]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
          {
            key: "shuffle",
            label: "Shuffle playlist",
            icon: Shuffle,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const primary = screen.getByRole("group", {
      name: "Primary playlist actions",
    });
    expect(
      within(primary).getByRole("button", { name: "Play" }),
    ).toHaveTextContent("Play");
    expect(
      within(primary).getByRole("button", { name: "Shuffle" }),
    ).toHaveTextContent("Shuffle");

    const secondary = screen.getByRole("group", {
      name: "Secondary playlist actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Playlist Radio" }),
    ).toHaveTextContent("Radio");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "More" }),
    ).toHaveTextContent("More");
  });

  it("opens the normalized glass context menu with playlist media header", async () => {
    render(
      <PlaylistHeroSection
        title="Friday Damage"
        subtitle="Public playlist"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-2xl",
      "z-app-context-menu",
    );
    expect(within(menu).getByText("Friday Damage")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Play playlist" }),
    ).toBeInTheDocument();
  });

  it("moves More to the fixed mobile hero corner", async () => {
    mockMobilePointer();

    render(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[
          {
            key: "radio",
            label: "Radio",
            ariaLabel: "Playlist Radio",
            icon: Radio,
            onClick: vi.fn(),
          },
        ]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const secondary = screen.getByRole("group", {
      name: "Secondary playlist actions",
    });
    expect(
      within(secondary).queryByRole("button", { name: "More" }),
    ).toBeNull();

    const heroMenu = screen.getByTestId("playlist-mobile-hero-menu");
    expect(heroMenu).toHaveAttribute("aria-label", "More");
    expect(heroMenu.parentElement).toHaveClass("fixed", "z-app-header");

    fireEvent.click(heroMenu);
    expect(
      await screen.findByRole("menuitem", { name: "Play playlist" }),
    ).toBeInTheDocument();
  });
});
