import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useApi = vi.hoisted(() =>
  vi.fn((url: string | null) => ({
    data: url === "/api/playlists" ? [{ id: 7, name: "Favorites" }] : null,
  })),
);

vi.mock("@/hooks/use-api", () => ({ useApi }));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlayerTrackMenu", () => {
  beforeEach(() => {
    useApi.mockClear();
  });

  it("loads existing playlists when the track menu opens", async () => {
    renderWithListenProviders(
      <PlayerTrackMenu
        currentTrack={{
          id: "track-1",
          title: "Talk For Hours",
          artist: "High Vis",
          album: "Blending",
        }}
      />,
      { locale: "es" },
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    await waitFor(() => {
      expect(useApi).toHaveBeenCalledWith("/api/playlists");
      expect(
        screen.getByRole("menuitem", { name: "Añadir a Favorites" }),
      ).toBeInTheDocument();
    });
  });
});
