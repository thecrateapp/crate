import { screen } from "@testing-library/react";
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

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
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
});
