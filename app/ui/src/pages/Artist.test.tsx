import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MergeArtistDialog, refreshArtistProbableSetlist } from "./Artist";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: null, loading: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/use-artist-data", () => ({
  useTopTracks: () => ({ data: [] }),
  useArtistEnrichment: () => ({
    enrichment: null,
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(),
}));

vi.mock("@/components/artist/ArtistHeroSection", () => ({
  ArtistHeroSection: () => null,
}));

vi.mock("@/components/artist/ArtistMetadataEditor", () => ({
  ArtistMetadataEditor: () => null,
}));

vi.mock("@/components/artist/ArtistRepairDialog", () => ({
  ArtistRepairDialog: () => null,
}));

vi.mock("@/components/artist/ArtistDiscographySection", () => ({
  ArtistDiscographySection: () => null,
}));

vi.mock("@/components/artist/ArtistAboutSection", () => ({
  ArtistAboutSection: () => null,
}));

vi.mock("@/components/artist/ArtistLoadingState", () => ({
  ArtistLoadingState: () => null,
}));

vi.mock("@/components/artist/ArtistOverviewSection", () => ({
  ArtistOverviewSection: () => null,
}));

vi.mock("@/components/artist/ArtistSetlistSection", () => ({
  ArtistSetlistSection: () => null,
}));

vi.mock("@/components/artist/ArtistShowsSection", () => ({
  ArtistShowsSection: () => null,
}));

vi.mock("@/components/artist/ArtistSimilarSection", () => ({
  ArtistSimilarSection: () => null,
}));

vi.mock("@/components/artist/ArtistStatsSection", () => ({
  ArtistStatsSection: () => null,
}));

vi.mock("@/components/artist/ArtistTopTracksSection", () => ({
  ArtistTopTracksSection: () => null,
}));

vi.mock("@/components/artist/ArtistTabsNav", () => ({
  ArtistTabsNav: () => null,
}));

vi.mock("@/components/artist/artistPageData", () => ({
  buildArtistTabs: () => [],
  buildArtistTags: () => [],
  buildExternalLinks: () => [],
  buildMergedSimilarArtists: () => [],
  computePopularityScore: () => 0,
}));

vi.mock("@/lib/system-playlist-blueprints", () => ({
  createSystemPlaylistFromBlueprint: vi.fn(),
}));

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue({
    artists: [
      {
        id: 22,
        entity_uid: "target-artist",
        slug: "target-artist",
        name: "Target Artist",
      },
    ],
  });
});

describe("MergeArtistDialog", () => {
  it("searches artists and returns the selected canonical artist", async () => {
    const onMerge = vi.fn();
    render(
      <MergeArtistDialog
        open
        currentArtistId={12}
        currentArtistName="Source Artist"
        busy={false}
        onOpenChange={vi.fn()}
        onMerge={onMerge}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "target");

    await screen.findByText("Target Artist");
    await userEvent.click(screen.getByText("Target Artist"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/search?q=target&limit=12");
    });
    expect(onMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 22,
        name: "Target Artist",
      }),
    );
  });
});

describe("refreshArtistProbableSetlist", () => {
  it("waits for the task and refetches enrichment", async () => {
    const refreshed = {
      setlist: {
        probable_setlist: [{ title: "New Song", frequency: 1, play_count: 3 }],
      },
    };
    const refetch = vi.fn().mockResolvedValue(refreshed);
    mockApi.mockResolvedValueOnce({
      task_id: "setlist-task",
      status: "queued",
    });
    mockWaitForTask.mockResolvedValueOnce({
      status: "completed",
      result: { status: "ready", songs: 1 },
    });

    const result = await refreshArtistProbableSetlist(
      { artistId: 42, artistEntityUid: "artist-uid" },
      refetch,
    );

    expect(mockApi).toHaveBeenCalledWith(
      "/api/artists/by-entity/artist-uid/probable-setlist/refresh",
      "POST",
    );
    expect(mockWaitForTask).toHaveBeenCalledWith("setlist-task", 120000);
    expect(refetch).toHaveBeenCalledOnce();
    expect(result).toEqual({ enrichment: refreshed, status: "ready" });
  });

  it("does not refetch when the refresh task fails", async () => {
    const refetch = vi.fn();
    mockApi.mockResolvedValueOnce({
      task_id: "setlist-task",
      status: "queued",
    });
    mockWaitForTask.mockResolvedValueOnce({
      status: "failed",
      error: "Setlist.fm rate limit exceeded",
    });

    await expect(
      refreshArtistProbableSetlist({ artistId: 42 }, refetch),
    ).rejects.toThrow("Setlist.fm rate limit exceeded");
    expect(refetch).not.toHaveBeenCalled();
  });
});
