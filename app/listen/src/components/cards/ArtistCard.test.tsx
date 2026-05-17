import { screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ArtistCard } from "./ArtistCard";

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
});
