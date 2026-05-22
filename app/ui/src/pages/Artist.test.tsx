import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MergeArtistDialog } from "./Artist";

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
  useArtistEnrichment: () => ({ enrichment: null, loading: false }),
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

const mockApi = vi.mocked(api);

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
