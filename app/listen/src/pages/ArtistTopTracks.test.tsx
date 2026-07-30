import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ArtistTopTracks } from "./ArtistTopTracks";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/components/cards/TrackRow", () => ({
  TrackRow: () => null,
}));

describe("ArtistTopTracks", () => {
  beforeEach(() => {
    vi.mocked(useApi).mockImplementation((url: string | null) => {
      if (url === "/api/artists/crossed") {
        return {
          data: { id: 7, slug: "crossed", name: "Crossed" },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("uses compact CTA corners for Play all", () => {
    renderWithListenProviders(<ArtistTopTracks />, {
      route: "/artists/crossed/top-tracks",
      path: "/artists/:artistSlug/top-tracks",
    });

    expect(screen.getByRole("button", { name: "Play" })).toHaveClass(
      "rounded-lg",
    );
  });
});
