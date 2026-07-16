import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: vi.fn(() => () => {}),
}));

import {
  SavedAlbumsProvider,
  useSavedAlbums,
} from "@/contexts/SavedAlbumsContext";

function Probe() {
  const { savedAlbums, loading, refetch } = useSavedAlbums();
  return (
    <div>
      <output>{savedAlbums.map((album) => album.name).join(",")}</output>
      <span>{loading ? "loading" : "idle"}</span>
      <button onClick={() => void refetch()}>refetch</button>
    </div>
  );
}

describe("SavedAlbumsProvider", () => {
  beforeEach(() => apiMock.mockReset());

  it("preserves the last valid library when a refetch fails", async () => {
    apiMock
      .mockResolvedValueOnce([
        {
          saved_at: "2026-07-15T00:00:00Z",
          id: 8,
          artist: "High Vis",
          name: "Guided Tour",
          year: "2024",
          has_cover: true,
          track_count: 11,
          total_duration: 1800,
        },
      ])
      .mockRejectedValueOnce(new Error("catalog refresh unavailable"));
    const user = userEvent.setup();
    render(
      <SavedAlbumsProvider>
        <Probe />
      </SavedAlbumsProvider>,
    );
    await screen.findByText("Guided Tour");

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(screen.getByText("Guided Tour")).toBeInTheDocument();
  });
});
