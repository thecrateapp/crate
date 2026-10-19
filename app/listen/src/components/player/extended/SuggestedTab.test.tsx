import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { SuggestedTab } from "./SuggestedTab";
import { useSuggestedTracks } from "./use-suggested-tracks";

vi.mock("./use-suggested-tracks", () => ({ useSuggestedTracks: vi.fn() }));
vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({ isLiked: () => false, toggleTrackLike: vi.fn() }),
}));

beforeEach(() =>
  vi.mocked(useSuggestedTracks).mockReturnValue({ tracks: [], loading: false }),
);

it("composes suggestions as a named TrackList and keeps their existing radio source on activation", () => {
  const play = vi.fn();
  vi.mocked(useSuggestedTracks).mockReturnValue({
    loading: false,
    tracks: [
      {
        track_id: 7,
        track_entity_uid: "suggested-7",
        path: "Artist/Album/Marea.flac",
        title: "Marea",
        artist: "Artist",
        album: "Album",
        duration: 180,
        score: 0.7,
      },
    ],
  });
  renderWithListenProviders(<SuggestedTab />, {
    playerActions: {
      currentTrack: {
        id: "seed",
        libraryTrackId: 1,
        path: "Artist/Album/Seed.flac",
        title: "Seed",
        artist: "Artist",
      },
      play,
    },
  });
  const list = screen.getByRole("group", { name: "Suggested" });
  const row = within(list).getByRole("row", { name: "Marea" });
  expect(list).toHaveAttribute("data-slot", "track-list");
  fireEvent.click(row);
  expect(play).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "suggested-7",
      libraryTrackId: 7,
      title: "Marea",
      duration: 180,
    }),
    { type: "radio", name: "Similar to Seed" },
  );
});

it("retains the empty state without manufacturing suggestions", () => {
  renderWithListenProviders(<SuggestedTab />);
  expect(screen.queryByRole("row")).not.toBeInTheDocument();
  expect(screen.getByText("No similar tracks found")).toBeVisible();
});
