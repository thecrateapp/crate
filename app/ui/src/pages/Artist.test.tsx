import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router";
import type { ReactNode } from "react";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const {
  mockUseApi,
  mockArtistEnrichment,
  mockOverview,
  mockHero,
  mockBioDialog,
  mockStats,
} = vi.hoisted(() => ({
  mockUseApi: vi.fn(),
  mockArtistEnrichment: vi.fn(),
  mockOverview: vi.fn(),
  mockHero: vi.fn(),
  mockBioDialog: vi.fn(),
  mockStats: vi.fn(),
}));

import {
  Artist,
  MergeArtistDialog,
  refreshArtistProbableSetlist,
} from "./Artist";

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
  ArtistHeroSection: (props: Record<string, unknown>) => {
    mockHero(props);
    return null;
  },
}));

vi.mock("@/components/artist/ArtistMetadataEditor", () => ({
  ArtistMetadataEditor: () => null,
}));
vi.mock("@/components/artist/ArtistBioResearchDialog", () => ({
  ArtistBioResearchDialog: (props: {
    onApply: (bio: string) => Promise<void>;
  }) => {
    mockBioDialog(props);
    return null;
  },
}));

vi.mock("@/components/artist/ArtistRepairDialog", () => ({
  ArtistRepairDialog: () => null,
}));

vi.mock("@/components/artist/ArtistDiscographySection", () => ({
  ArtistDiscographySection: () => null,
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
  ArtistStatsSection: (props: Record<string, unknown>) => {
    mockStats(props);
    return null;
  },
}));

vi.mock("@/components/artist/ArtistTopTracksSection", () => ({
  ArtistTopTracksSection: () => null,
}));

vi.mock("@/components/artist/ArtistTabsNav", () => ({
  ArtistTabsNav: ({
    children,
    onChange,
  }: {
    children: ReactNode;
    onChange: (value: string) => void;
  }) => (
    <>
      <button onClick={() => onChange("stats")}>Open stats test tab</button>
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
import { waitForTask } from "@/lib/tasks";

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

beforeEach(() => {
  vi.clearAllMocks();
  mockArtistEnrichment.mockReturnValue({
    enrichment: null,
    loading: false,
    refetch: vi.fn(),
  });
  mockUseApi.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
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

describe("Artist page load state", () => {
  it("supplies the complete artist and library data to the consolidated Overview", async () => {
    const enrichment = {
      musicbrainz: {
        area: "Toronto",
        country: "CA",
        members: [{ name: "Member" }],
      },
      lastfm: { listeners: 123, playcount: 456 },
      spotify: { followers: 789, popularity: 30 },
    };
    mockArtistEnrichment.mockReturnValue({
      enrichment,
      loading: false,
      refetch: vi.fn(),
    });
    mockUseApi.mockImplementation((url: string | null) => ({
      data:
        url === "/api/artist-slugs/artist"
          ? {
              id: 7,
              slug: "artist",
              name: "Artist",
              bio: "Biography",
              albums: [
                { name: "One", tracks: 4, size_mb: 100 },
                { name: "Two", tracks: 8, size_mb: 200 },
              ],
            }
          : null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug" element={<Artist />} />
      </Routes>,
      { route: "/artists/artist#about" },
    );
    await waitFor(() =>
      expect(mockOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          bioText: "Biography",
          musicbrainz: enrichment.musicbrainz,
          lastfm: enrichment.lastfm,
          spotify: enrichment.spotify,
          albumCount: 2,
          totalTracks: 12,
          totalSizeMb: 300,
        }),
      ),
    );
    expect(screen.getByTestId("artist-overview")).toBeInTheDocument();
  });

  it("loads an artist reached through the legacy numeric-ID URL", async () => {
    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<Artist />} />
      </Routes>,
      { route: "/artists/42/the-clash" },
    );

    await waitFor(() => {
      expect(mockUseApi).toHaveBeenCalledWith("/api/artists/42");
    });
  });

  it("shows a retryable error when the artist request fails", async () => {
    const refetch = vi.fn();
    mockUseApi.mockImplementation((url: string | null) => ({
      data: null,
      loading: false,
      error: url ? "network error" : null,
      refetch,
    }));

    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug" element={<Artist />} />
      </Routes>,
      { route: "/artists/camel" },
    );

    expect(
      screen.getByText(
        "This artist could not be loaded. Try again or return to Browse.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("distinguishes an absent artist from a failed request", () => {
    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug" element={<Artist />} />
      </Routes>,
      { route: "/artists/missing-artist" },
    );

    expect(
      screen.getByRole("heading", { name: "Artist not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse artists" }),
    ).toHaveAttribute("href", "/browse");
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

    const result = await screen.findByText("Target Artist");
    const resultButton = result.closest("button");
    expect(resultButton).toHaveClass("hover:text-accent-action-hi");
    expect(resultButton).not.toHaveClass("hover:bg-accent-action/8");
    expect(resultButton).not.toHaveClass("text-white/88");

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

it("enables analysis for a capable non-admin role", async () => {
  mockUseApi.mockImplementation((url: string | null) => ({
    data:
      url === "/api/artist-slugs/camel"
        ? { id: 7, name: "Camel", slug: "camel", albums: [] }
        : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  await act(async () => {
    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug" element={<Artist />} />
      </Routes>,
      {
        route: "/artists/camel",
        auth: {
          isAdmin: false,
          hasCapability: (cap) => cap === "library.analysis.manage",
        },
      },
    );
  });
  expect(mockHero).toHaveBeenLastCalledWith(
    expect.objectContaining({ canAnalyze: true, canEditMetadata: false }),
  );
});

it("persists the Overview biography proposal before refetch and displays canonical saved text over old provider prose", async () => {
  let completeSave!: (value: Awaited<ReturnType<typeof waitForTask>>) => void;
  const saved = new Promise<Awaited<ReturnType<typeof waitForTask>>>(
    (resolve) => {
      completeSave = resolve;
    },
  );
  mockApi.mockResolvedValue({ task_id: "save-reviewed-bio" });
  mockWaitForTask.mockReturnValue(saved);
  let canonicalBio = "Old canonical biography";
  const refetch = vi.fn();
  mockArtistEnrichment.mockReturnValue({
    enrichment: { lastfm: { bio: "Old provider biography" } },
    loading: false,
    refetch: vi.fn(),
  });
  mockUseApi.mockImplementation((url: string | null) => ({
    data:
      url === "/api/artist-slugs/artist"
        ? {
            id: 7,
            entity_uid: "artist-uid",
            slug: "artist",
            name: "Artist",
            bio: canonicalBio,
            albums: [],
          }
        : null,
    loading: false,
    error: null,
    refetch,
  }));
  const routes = (
    <Routes>
      <Route path="/artists/:artistSlug" element={<Artist />} />
    </Routes>
  );
  const { unmount } = renderWithAdminProviders(routes, {
    route: "/artists/artist",
  });
  await waitFor(() => expect(mockBioDialog).toHaveBeenCalled());
  const proposal = "Reviewed canonical biography";
  const { onApply } = mockBioDialog.mock.lastCall![0] as {
    onApply: (bio: string) => Promise<void>;
  };
  const applying = onApply(proposal);
  await waitFor(() =>
    expect(mockWaitForTask).toHaveBeenCalledWith("save-reviewed-bio", 60000),
  );
  expect(refetch).not.toHaveBeenCalled();
  await act(async () => {
    canonicalBio = proposal;
    completeSave({ status: "completed", result: { changed_fields: ["bio"] } });
    await applying;
  });
  expect(mockApi).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-uid/metadata",
    "PUT",
    { bio: proposal },
  );
  expect(refetch).toHaveBeenCalledTimes(1);
  unmount();
  renderWithAdminProviders(routes, { route: "/artists/artist" });
  await waitFor(() =>
    expect(mockOverview).toHaveBeenLastCalledWith(
      expect.objectContaining({ bioText: proposal }),
    ),
  );
});

it("passes the loaded catalogue identity to Stats without another catalogue request", async () => {
  const albums = [
    {
      id: 44,
      entity_uid: "album-44",
      name: "Full catalogue album",
      year: "2004",
      tracks: 4,
      formats: ["FLAC"],
      size_mb: 100,
      has_cover: true,
    },
  ];
  mockUseApi.mockImplementation((url: string | null) => ({
    data:
      url === "/api/artist-slugs/camel"
        ? {
            id: 7,
            entity_uid: "artist-7",
            slug: "camel",
            name: "Camel",
            albums,
            total_tracks: 20,
            genre_profile: [{ name: "Rock", weight: 0.8 }],
          }
        : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
  renderWithAdminProviders(
    <Routes>
      <Route path="/artists/:artistSlug" element={<Artist />} />
    </Routes>,
    { route: "/artists/camel" },
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open stats test tab" }),
  );
  expect(mockStats).toHaveBeenLastCalledWith(
    expect.objectContaining({
      artistId: 7,
      artistEntityUid: "artist-7",
      catalogueAlbums: albums,
      totalTracks: 20,
      genreProfile: [{ name: "Rock", weight: 0.8 }],
    }),
  );
});
