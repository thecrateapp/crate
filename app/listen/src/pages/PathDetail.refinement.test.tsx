import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

const apiState = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({ playAll: vi.fn(), currentTrack: null }),
  usePlayerState: () => ({ isPlaying: false }),
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: apiState.data, refetch: vi.fn() }),
}));
vi.mock("./PathDetailHeaderView", () => ({
  PathDetailHeaderView: () => null,
}));
vi.mock("@/components/paths/PathCoverJourney", () => ({
  PathCoverJourney: () => null,
}));
vi.mock("./PathDetailParts", () => ({ PathTrackList: () => null }));
import { PathDetail } from "./PathDetail";

function path(refinement?: { status: string }) {
  return {
    id: 123,
    name: "A to B",
    origin: { label: "A" },
    destination: { label: "B" },
    tracks: [{ track_id: 42, title: "Track", artist: "Artist" }],
    revision: refinement?.status === "applied" ? 2 : 1,
    ...(refinement ? { refinement } : {}),
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/paths/123"]}>
      <Routes>
        <Route path="/paths/:id" element={<PathDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiState.data = null;
});

it("shows the AI refining label until the refined revision arrives", () => {
  apiState.data = path({ status: "pending" });
  const { rerender } = renderDetail();

  const label = screen.getByRole("status", {
    name: "paths.refinement.pending",
  });
  expect(label).toHaveTextContent("paths.refinement.pending");

  apiState.data = path({ status: "applied" });
  rerender(
    <MemoryRouter initialEntries={["/paths/123"]}>
      <Routes>
        <Route path="/paths/:id" element={<PathDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("status", { name: "paths.refinement.pending" }),
  ).toBeNull();
});

it("shows no refinement label for a deterministic path", () => {
  apiState.data = path();
  renderDetail();
  expect(
    screen.queryByRole("status", { name: "paths.refinement.pending" }),
  ).toBeNull();
});
