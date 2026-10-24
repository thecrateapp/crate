import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LikedTracksProvider } from "@/contexts/LikedTracksContext";
import { api } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryLikedTab } from "./LibraryLikedTab";
import { TrackRow } from "@/components/cards/TrackRow";

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  api: vi.fn(),
}));

const likedTrack = {
  track_id: 31,
  path: "alpha/first.flac",
  liked_at: "2026-10-20T10:00:00Z",
  title: "Alpha Track",
  artist: "Alpha",
  album: "First",
  duration: 120,
};

beforeEach(() => vi.mocked(api).mockReset());

it("never replaces the queue with excluded likes when a filter has no matches", async () => {
  vi.mocked(api).mockResolvedValue([likedTrack]);
  const playAll = vi.fn();
  const user = userEvent.setup();
  renderWithListenProviders(
    <LikedTracksProvider>
      <LibraryLikedTab />
    </LikedTracksProvider>,
    { playerActions: { playAll } },
  );
  await screen.findByText("Alpha Track");
  await user.type(screen.getByRole("searchbox"), "no-match-at-all");
  const play = await screen.findByRole("button", { name: "Play 0" });
  expect(play).toBeDisabled();
  await user.click(play);
  expect(playAll).not.toHaveBeenCalled();
  expect(screen.getByText("No tracks match this filter")).toBeInTheDocument();
});

it("shows a retryable read failure instead of confirming an empty liked library", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  renderWithListenProviders(
    <LikedTracksProvider>
      <LibraryLikedTab />
    </LikedTracksProvider>,
  );
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No liked tracks yet")).not.toBeInTheDocument();
  vi.mocked(api).mockResolvedValue([likedTrack]);
  await user.click(retry);
  await screen.findByText("Alpha Track");
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

it("keeps the track heart unavailable until the liked collection can be confirmed", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  renderWithListenProviders(
    <LikedTracksProvider>
      <TrackRow
        track={{
          id: 31,
          library_track_id: 31,
          title: "Alpha Track",
          artist: "Alpha",
          album: "First",
          duration: 120,
          path: "alpha/first.flac",
        }}
      />
      <LibraryLikedTab />
    </LikedTracksProvider>,
  );
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(
    screen.getByRole("button", { name: "Liked status unavailable" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Like track" }),
  ).not.toBeInTheDocument();
  vi.mocked(api).mockResolvedValue([likedTrack]);
  await user.click(retry);
  await screen.findAllByRole("button", { name: "Unlike track" });
  expect(
    screen.queryByRole("button", { name: "Liked status unavailable" }),
  ).not.toBeInTheDocument();
  expect(
    vi.mocked(api).mock.calls.every(([, method]) => method === "GET"),
  ).toBe(true);
});
