import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
const playAll = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({ playAll, currentTrack: null }),
  usePlayerState: () => ({ isPlaying: false }),
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: {
      id: 123,
      name: "A to B",
      origin: { label: "A" },
      destination: { label: "B" },
      tracks: [
        {
          track_id: 42,
          title: "Track",
          artist: "Artist",
          entity_uid: "123e4567-e89b-12d3-a456-426614174042",
        },
      ],
    },
    refetch: vi.fn(),
  }),
}));
vi.mock("./PathDetailHeaderView", () => ({
  PathDetailHeaderView: ({ onPlay }: { onPlay: () => void }) => (
    <button type="button" onClick={onPlay}>
      Play path
    </button>
  ),
}));
vi.mock("@/components/paths/PathCoverJourney", () => ({
  PathCoverJourney: () => null,
}));
vi.mock("./PathDetailParts", () => ({ PathTrackList: () => null }));
import { PathDetail } from "./PathDetail";
it("plays Path 123 with its own finite path source and navigation", () => {
  render(
    <MemoryRouter initialEntries={["/paths/123"]}>
      <Routes>
        <Route path="/paths/:id" element={<PathDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play path" }));
  const source = playAll.mock.calls[0]![2];
  expect(source).toEqual({
    type: "path",
    id: 123,
    name: "A to B",
    href: "/paths/123",
  });
  expect(source.radio).toBeUndefined();
});
