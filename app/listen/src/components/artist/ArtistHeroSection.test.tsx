import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistHeroSection } from "./ArtistHeroSection";

vi.mock("@/components/bandcamp/BandcampSupportButton", () => ({
  BandcampSupportButton: ({
    presentation,
  }: {
    presentation?: "secondary-action";
  }) => (
    <button
      type="button"
      aria-label="Support on Bandcamp"
      className={presentation === "secondary-action" ? "mock-secondary" : ""}
    >
      Bandcamp
    </button>
  ),
}));

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

describe("ArtistHeroSection", () => {
  it("keeps artist genres out of the hero surface", () => {
    render(
      <MemoryRouter>
        <ArtistHeroSection
          artist={{
            id: 7,
            entity_uid: "artist-entity-7",
            slug: "crossed",
            name: "Crossed",
            albums: [],
            total_tracks: 10,
            total_size_mb: 120,
            primary_format: "flac",
            genres: ["hardcore"],
            genre_profile: [{ name: "hardcore", slug: "hardcore" }],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "",
            tags: ["hardcore"],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
          photoUrl="/artist.jpg"
          tags={["hardcore"]}
          following={false}
          onPlay={vi.fn()}
          onShuffle={vi.fn()}
          onArtistRadio={vi.fn()}
          onToggleFollow={vi.fn()}
          onShare={vi.fn()}
          onOpenBio={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("hardcore")).not.toBeInTheDocument();
  });

  it("groups desktop hero actions into primary pills and secondary icon labels", () => {
    render(
      <MemoryRouter>
        <ArtistHeroSection
          artist={{
            id: 7,
            entity_uid: "artist-entity-7",
            slug: "crossed",
            name: "Crossed",
            albums: [],
            total_tracks: 10,
            total_size_mb: 120,
            primary_format: "flac",
            genres: ["hardcore"],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "",
            tags: [],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
          photoUrl="/artist.jpg"
          tags={["hardcore"]}
          following={false}
          onPlay={vi.fn()}
          onShuffle={vi.fn()}
          onArtistRadio={vi.fn()}
          onToggleFollow={vi.fn()}
          onShare={vi.fn()}
          onOpenBio={vi.fn()}
        />
      </MemoryRouter>,
    );

    const primary = screen.getByRole("group", {
      name: "Primary artist actions",
    });
    expect(
      within(primary).getByRole("button", { name: "Play" }),
    ).toHaveTextContent("Play");
    expect(
      within(primary).getByRole("button", { name: "Shuffle" }),
    ).toHaveTextContent("Shuffle");

    const secondary = screen.getByRole("group", {
      name: "Secondary artist actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Artist Radio" }),
    ).toHaveTextContent("Radio");
    expect(
      within(secondary).getByRole("button", { name: "Follow" }),
    ).toHaveTextContent("Follow");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "More" }),
    ).toHaveTextContent("More");
  });

  it("renders the desktop more menu outside the horizontally scrolling action row", async () => {
    render(
      <MemoryRouter>
        <ArtistHeroSection
          artist={{
            id: 7,
            entity_uid: "artist-entity-7",
            slug: "crossed",
            name: "Crossed",
            albums: [],
            total_tracks: 10,
            total_size_mb: 120,
            primary_format: "flac",
            genres: ["hardcore"],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "",
            tags: [],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
          photoUrl="/artist.jpg"
          tags={["hardcore"]}
          following={false}
          onPlay={vi.fn()}
          onShuffle={vi.fn()}
          onArtistRadio={vi.fn()}
          onToggleFollow={vi.fn()}
          onShare={vi.fn()}
          onOpenBio={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-2xl",
      "z-app-context-menu",
    );

    const menuItem = await screen.findByRole("menuitem", {
      name: "Play top tracks",
    });
    expect(menuItem.closest(".overflow-x-auto")).toBeNull();
  });

  it("uses the mobile Tidal-style artist action layout", async () => {
    mockMobilePointer();

    render(
      <MemoryRouter>
        <ArtistHeroSection
          artist={{
            id: 7,
            entity_uid: "artist-entity-7",
            slug: "crossed",
            name: "Crossed",
            albums: [],
            total_tracks: 10,
            total_size_mb: 120,
            primary_format: "flac",
            genres: ["hardcore"],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "Crossed bio.",
            tags: [],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
          photoUrl="/artist.jpg"
          tags={["hardcore"]}
          following={false}
          onPlay={vi.fn()}
          onShuffle={vi.fn()}
          onArtistRadio={vi.fn()}
          onPlaySetlist={vi.fn()}
          hasSetlist
          onToggleFollow={vi.fn()}
          onShare={vi.fn()}
          onOpenBio={vi.fn()}
        />
      </MemoryRouter>,
    );

    const primary = screen.getByRole("group", {
      name: "Primary artist actions",
    });
    expect(primary).toHaveClass("grid", "grid-cols-2");
    expect(
      within(primary).getByRole("button", { name: "Play" }),
    ).toHaveTextContent("Play");
    expect(
      within(primary).getByRole("button", { name: "Shuffle" }),
    ).toHaveTextContent("Shuffle");

    const secondary = screen.getByRole("group", {
      name: "Secondary artist actions",
    });
    expect(secondary).toHaveClass("grid", "grid-cols-5");

    const radio = within(secondary).getByRole("button", {
      name: "Artist Radio",
    });
    expect(radio).toHaveTextContent("Radio");
    expect(radio).toHaveClass("hover:text-primary");
    expect(radio.className).toContain("hover:drop-shadow");
    expect(radio).not.toHaveClass("rounded-lg");

    expect(
      within(secondary).getByRole("button", { name: "Setlist" }),
    ).toHaveTextContent("Setlist");
    expect(
      within(secondary).getByRole("button", { name: "Follow" }),
    ).toHaveTextContent("Follow");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "Support on Bandcamp" }),
    ).toHaveTextContent("Bandcamp");

    const heroMenu = screen.getByTestId("artist-mobile-hero-menu");
    expect(heroMenu).toHaveAttribute("aria-label", "More");
    expect(heroMenu.parentElement).not.toBeNull();
    expect(heroMenu.parentElement!).toHaveClass("fixed", "z-app-header");
    expect(heroMenu.parentElement!).not.toHaveClass("z-app-context-menu");
    expect(
      screen.getByTestId("artist-mobile-hero-menu-icon"),
    ).toBeInTheDocument();
    expect(
      within(secondary).queryByRole("button", { name: "More" }),
    ).toBeNull();

    fireEvent.click(heroMenu);
    expect(
      await screen.findByRole("menuitem", { name: "Play top tracks" }),
    ).toBeInTheDocument();
  });
});
