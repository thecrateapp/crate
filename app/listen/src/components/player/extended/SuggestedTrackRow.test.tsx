import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { SuggestedTrackRow } from "./SuggestedTrackRow";
import type { SimilarTrack } from "./use-suggested-tracks";

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({ isLiked: () => false, toggleTrackLike: vi.fn() }),
}));

const track: SimilarTrack = {
  track_id: 7,
  track_entity_uid: "suggested-7",
  path: "Costa Norte/Luz de octubre/Marea.flac",
  title: "Marea",
  artist: "Costa Norte",
  album: "Luz de octubre",
  duration: 180,
  score: 0.74,
};

it("uses the real TrackRow frame, cover/play control, duration and menu without changing the play callback", () => {
  const play = vi.fn();
  const like = vi.fn();
  renderWithListenProviders(
    <SuggestedTrackRow track={track} index={0} onPlay={play} />,
    { playerActions: { play: like } },
  );
  const row = screen.getByRole("row", { name: "Marea" });
  expect(row).toHaveClass("track-row");
  expect(within(row).getByText("3:00")).toBeVisible();
  expect(within(row).getByText(/74/)).toBeVisible();
  expect(
    within(row).getByRole("button", { name: "More actions" }),
  ).toBeVisible();
  fireEvent.click(within(row).getByRole("button", { name: "Play Marea" }));
  expect(play).toHaveBeenCalledExactlyOnceWith(track);
  expect(like).not.toHaveBeenCalled();
});

it("retains per-track source metadata and album references already supplied by the API", () => {
  const richTrack = {
    ...track,
    album_id: 12,
    sample_rate: 96000,
    bit_depth: 24,
    format: "FLAC",
  };
  renderWithListenProviders(
    <SuggestedTrackRow track={richTrack} index={1} onPlay={() => {}} />,
  );
  const row = screen.getByRole("row", { name: "Marea" });
  expect(within(row).getByText("Hi-Res 24/96")).toBeVisible();
  expect(row.querySelector(".crate-track-leading-artwork")).toBeInTheDocument();
});
