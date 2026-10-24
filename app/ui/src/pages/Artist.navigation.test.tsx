import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Link, Route, Routes } from "react-router";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { mockUseApi, mockArtistEnrichment, mockOverview } = vi.hoisted(() => ({
  mockUseApi: vi.fn(),
  mockArtistEnrichment: vi.fn(),
  mockOverview: vi.fn(),
}));

import { Artist } from "./Artist";

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
  useApi: mockUseApi,
}));

vi.mock("@/hooks/use-artist-data", () => ({
  useTopTracks: () => [],
  useArtistEnrichment: mockArtistEnrichment,
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
  ArtistDiscographySection: ({
    artistName,
    tidalMissing,
    onDownloadDiscography,
  }: any) => (
    <div>
      <output>
        {artistName}: {tidalMissing.map((a: any) => a.title).join(",")}
      </output>
      <button onClick={onDownloadDiscography}>Mock download</button>
    </div>
  ),
}));

vi.mock("@/components/artist/ArtistLoadingState", () => ({
  ArtistLoadingState: () => null,
}));

vi.mock("@/components/artist/ArtistOverviewSection", () => ({
  ArtistOverviewSection: (props: Record<string, unknown>) => {
    mockOverview(props);
    return <div data-testid="artist-overview" />;
  },
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
  ArtistTabsNav: ({ children, onChange }: any) => (
    <>
      <button onClick={() => onChange("discography")}>Discography</button>
      {children}
    </>
  ),
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

it("reloads auxiliary albums for the new artist before enabling acquisition", async () => {
  mockArtistEnrichment.mockReturnValue({
    enrichment: null,
    loading: false,
    refetch: vi.fn(),
  });
  mockUseApi.mockImplementation((url: string | null) => ({
    data: url?.startsWith("/api/artist-slugs/")
      ? {
          id: url.endsWith("alpha") ? 1 : 2,
          entity_uid: url.endsWith("alpha") ? "alpha-uid" : "beta-uid",
          slug: url.endsWith("alpha") ? "alpha" : "beta",
          name: url.endsWith("alpha") ? "Alpha" : "Beta",
          albums: [],
          genres: [],
        }
      : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  mockApi.mockImplementation(async (url: string) => {
    if (url.endsWith("/shows")) return { events: [], configured: true };
    if (url.includes("/tidal/") && url.includes("/missing/"))
      return {
        albums: [
          {
            url: url.includes("beta-uid")
              ? "https://tidal.com/album/beta-release"
              : "https://tidal.com/album/alpha-release",
            title: url.includes("beta-uid") ? "Beta release" : "Alpha release",
            year: "2026",
            tracks: 2,
            cover: null,
          },
        ],
        authenticated: true,
      };
    if (url.endsWith("/missing")) return { missing: [] };
    if (url.includes("download-missing")) return { queued: 1 };
    return {};
  });
  renderWithAdminProviders(
    <>
      <Link to="/artists/beta">Next artist</Link>
      <Routes>
        <Route path="/artists/:artistSlug" element={<Artist />} />
      </Routes>
    </>,
    { route: "/artists/alpha" },
  );
  await userEvent.click(screen.getByRole("button", { name: "Discography" }));
  await screen.findByText("Alpha: Alpha release");
  await userEvent.click(screen.getByRole("link", { name: "Next artist" }));
  await userEvent.click(screen.getByRole("button", { name: "Discography" }));
  await screen.findByText("Beta: Beta release");
  expect(
    mockApi.mock.calls.some(
      ([url]) =>
        String(url).includes("beta-uid") &&
        String(url).includes("/tidal/") &&
        String(url).includes("/missing/"),
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Mock download" }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      expect.stringContaining("beta-uid"),
      "POST",
      {
        albums: [
          {
            url: "https://tidal.com/album/beta-release",
            title: "Beta release",
            cover_url: null,
          },
        ],
      },
    ),
  );
});

it("keeps unavailable artist shows visible as a retryable read error", async () => {
  vi.clearAllMocks();
  mockArtistEnrichment.mockReturnValue({
    enrichment: null,
    loading: false,
    refetch: vi.fn(),
  });
  mockUseApi.mockImplementation((url: string | null) => ({
    data: url?.startsWith("/api/artist-slugs/")
      ? {
          id: 1,
          entity_uid: "alpha-uid",
          slug: "alpha",
          name: "Alpha",
          albums: [],
          genres: [],
        }
      : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  mockApi
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ events: [], configured: true });
  renderWithAdminProviders(
    <Routes>
      <Route path="/artists/:artistSlug" element={<Artist />} />
    </Routes>,
    { route: "/artists/alpha" },
  );
  await screen.findByText("Upcoming shows could not be loaded.");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Upcoming shows could not be loaded."),
    ).not.toBeInTheDocument(),
  );
  expect(mockApi).toHaveBeenCalledTimes(2);
});
