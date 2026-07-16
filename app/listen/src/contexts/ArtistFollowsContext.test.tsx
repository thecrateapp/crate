import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: vi.fn(() => () => {}),
}));

import {
  ArtistFollowsProvider,
  useArtistFollows,
} from "@/contexts/ArtistFollowsContext";

function Probe() {
  const { followedArtists, loading, refetch } = useArtistFollows();
  return (
    <div>
      <output>
        {followedArtists.map((artist) => artist.artist_name).join(",")}
      </output>
      <span>{loading ? "loading" : "idle"}</span>
      <button onClick={() => void refetch()}>refetch</button>
    </div>
  );
}

describe("ArtistFollowsProvider", () => {
  beforeEach(() => apiMock.mockReset());

  it("preserves the last valid library when a refetch fails", async () => {
    apiMock
      .mockResolvedValueOnce([
        {
          artist_name: "High Vis",
          artist_id: 7,
          created_at: "2026-07-15T00:00:00Z",
        },
      ])
      .mockRejectedValueOnce(new Error("catalog refresh unavailable"));
    const user = userEvent.setup();
    render(
      <ArtistFollowsProvider>
        <Probe />
      </ArtistFollowsProvider>,
    );
    await screen.findByText("High Vis");

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(screen.getByText("High Vis")).toBeInTheDocument();
  });
});
