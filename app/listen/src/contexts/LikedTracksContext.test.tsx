import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: vi.fn(() => () => {}),
}));

import {
  LikedTracksProvider,
  useLikedTracks,
} from "@/contexts/LikedTracksContext";

function Probe() {
  const likes = useLikedTracks();
  const liked = likes.isLiked(
    99,
    "different-local-source",
    "/other",
    "global-1",
  );
  return (
    <div>
      <output>{liked ? "liked" : "not-liked"}</output>
      <span>{likes.loading ? "loading" : "idle"}</span>
      <button onClick={() => void likes.refetch()}>refetch</button>
      <button
        onClick={() =>
          void likes
            .unlikeTrack(99, "different-local-source", "/other", "global-1")
            .catch(() => undefined)
        }
      >
        unlike
      </button>
    </div>
  );
}

describe("LikedTracksProvider global identity", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (_url: string, method = "GET") => {
      if (method === "GET") {
        return [
          {
            global_track_uid: "global-1",
            liked_at: "2026-07-14T00:00:00Z",
            title: "Remote track",
            artist: "Remote artist",
            availability: { local: false, remote: true },
          },
        ];
      }
      return { ok: true };
    });
  });

  it("shares one liked state across different sources of a global track", async () => {
    const user = userEvent.setup();
    render(
      <LikedTracksProvider>
        <Probe />
      </LikedTracksProvider>,
    );

    await waitFor(() => expect(screen.getByText("liked")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "unlike" }));

    await waitFor(() =>
      expect(screen.getByText("not-liked")).toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenLastCalledWith("/api/me/likes", "DELETE", {
      track_id: 99,
      global_track_uid: "global-1",
      track_entity_uid: "different-local-source",
      track_path: "/other",
    });
  });

  it("rolls an optimistic unlike back when persistence fails", async () => {
    apiMock.mockImplementation(async (_url: string, method = "GET") => {
      if (method === "GET") {
        return [
          {
            global_track_uid: "global-1",
            liked_at: "2026-07-14T00:00:00Z",
            title: "Remote track",
            artist: "Remote artist",
          },
        ];
      }
      throw new Error("offline");
    });
    const user = userEvent.setup();
    render(
      <LikedTracksProvider>
        <Probe />
      </LikedTracksProvider>,
    );

    await waitFor(() => expect(screen.getByText("liked")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "unlike" }));
    await waitFor(() => expect(screen.getByText("liked")).toBeInTheDocument());
  });

  it("preserves the last valid library when a refetch fails", async () => {
    apiMock
      .mockResolvedValueOnce([
        {
          global_track_uid: "global-1",
          liked_at: "2026-07-14T00:00:00Z",
          title: "Remote track",
          artist: "Remote artist",
        },
      ])
      .mockRejectedValueOnce(new Error("catalog refresh unavailable"));
    const user = userEvent.setup();
    render(
      <LikedTracksProvider>
        <Probe />
      </LikedTracksProvider>,
    );
    await screen.findByText("liked");

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(screen.getByText("liked")).toBeInTheDocument();
  });
});
