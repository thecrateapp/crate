import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlbumCard } from "./AlbumCard";

const mocks = vi.hoisted(() => ({
  albumPagePath: vi.fn(() => "/album"),
  navigate: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/lib/library-routes", () => ({
  albumActionApiPath: vi.fn(() => "/api/albums/1/fetch-cover"),
  albumCoverApiUrl: vi.fn(() => "/api/albums/1/cover"),
  albumPagePath: mocks.albumPagePath,
}));

vi.mock("@/components/ui/music-context-menu", () => ({
  MusicContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));

describe("AlbumCard", () => {
  beforeEach(() => {
    mocks.albumPagePath.mockClear();
    mocks.navigate.mockClear();
  });

  it("uses the API-provided canonical artist slug for navigation", () => {
    render(
      <AlbumCard
        albumId={3188}
        albumSlug="bolsa-amarilla-y-piedra-potente"
        artist="Derby Motoreta’s Burrito Kachimba"
        artistSlug="derby-motoretas-burrito-kachimba"
        name="Bolsa Amarilla y Piedra Potente"
        tracks={12}
        formats={["FLAC"]}
      />,
    );

    fireEvent.click(screen.getByText("Bolsa Amarilla y Piedra Potente"));

    expect(mocks.albumPagePath).toHaveBeenCalledWith(
      expect.objectContaining({
        artistSlug: "derby-motoretas-burrito-kachimba",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/album");
  });
});
