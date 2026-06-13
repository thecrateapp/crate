import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ArtistCard } from "./ArtistCard";

const { resolveMaybeApiAssetUrlMock } = vi.hoisted(() => ({
  resolveMaybeApiAssetUrlMock: vi.fn(
    (url: string | null | undefined) => url ?? null,
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    resolveMaybeApiAssetUrl: resolveMaybeApiAssetUrlMock,
  };
});

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

function mockPointerEnvironment(desktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        desktop &&
        (query.includes("min-width: 768px") ||
          query === "(hover: hover) and (pointer: fine)"),
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
  mockPointerEnvironment(false);
  resolveMaybeApiAssetUrlMock.mockImplementation(
    (url: string | null | undefined) => url ?? null,
  );
});

describe("ArtistCard", () => {
  it("renders external artists with muted imagery and no provider overlay", () => {
    renderWithListenProviders(
      <ArtistCard
        name="Chelsea Wolfe"
        photo="https://lastfm.example/chelsea-wolfe.jpg"
        href="https://www.last.fm/music/Chelsea+Wolfe"
        external
        imageTone="muted"
      />,
    );

    const image = screen.getByAltText("Chelsea Wolfe");
    expect(image).toHaveAttribute(
      "src",
      "https://lastfm.example/chelsea-wolfe.jpg",
    );
    expect(image).toHaveClass("grayscale");
    expect(screen.getByText("Chelsea Wolfe").closest("a")).toHaveAttribute(
      "href",
      "https://www.last.fm/music/Chelsea+Wolfe",
    );
    expect(screen.queryByText("Last.fm")).not.toBeInTheDocument();
  });

  it("normalizes API-relative external photos before rendering", () => {
    resolveMaybeApiAssetUrlMock.mockImplementation((url) =>
      url?.startsWith("/api/")
        ? `https://api.example.test${url}&token=desktop-token`
        : url ?? null,
    );

    renderWithListenProviders(
      <ArtistCard
        name="Poison The Well"
        photo="/api/network/external-artist/photo?name=Poison%20The%20Well"
        href="https://www.last.fm/music/Poison+The+Well"
        external
        imageTone="muted"
      />,
    );

    expect(screen.getByAltText("Poison The Well")).toHaveAttribute(
      "src",
      "https://api.example.test/api/network/external-artist/photo?name=Poison%20The%20Well&token=desktop-token",
    );
  });

  it("opens the desktop action menu when the artist only has stable route identifiers", async () => {
    mockPointerEnvironment(true);

    renderWithListenProviders(
      <ArtistCard
        name="Dredg"
        artistEntityUid="artist-entity-1"
        artistSlug="dredg"
      />,
    );

    const card = screen.getByText("Dredg").closest('[role="button"]');
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-2xl");
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(
      await within(menu).findByRole("menuitem", { name: "Share artist" }),
    ).toBeInTheDocument();
  });
});
