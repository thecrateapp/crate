import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import type { HomeDiscoveryPayload } from "@/components/home/home-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Home } from "./Home";

const viewportState = vi.hoisted(() => ({ isDesktop: false }));

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => viewportState.isDesktop,
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
    apiSseUrl: vi.fn((path: string) => path),
  };
});

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: vi.fn(() => false),
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {}

  addEventListener = vi.fn();
  close = vi.fn();
}

function homeDiscoveryPayload(): HomeDiscoveryPayload {
  return {
    snapshot: {
      scope: "home",
      subject_key: "user:1",
      version: 1,
      stale: false,
      generation_ms: 1,
    },
    hero: [
      {
        id: 7,
        slug: "converge",
        name: "Converge",
        genres: ["Hardcore"],
        listeners: 639_200,
        scrobbles: 52_600_000,
        album_count: 9,
        track_count: 118,
        bio: "Converge are a Massachusetts hardcore band.",
      },
    ],
    recently_played: [],
    custom_mixes: [],
    suggested_albums: [],
    recommended_tracks: [],
    radio_stations: [],
    favorite_artists: [],
    essentials: [],
    recent_global_artists: [],
    upcoming: {
      items: [],
      insights: [],
      summary: {
        followed_artists: 0,
        show_count: 0,
        release_count: 0,
        attending_count: 0,
        insight_count: 0,
      },
    },
    replay: {
      window: "month:2026-06",
      title: "Crate DNA",
      subtitle: "June 2026",
      track_count: 0,
      minutes_listened: 0,
      items: [],
    },
  };
}

describe("Home", () => {
  beforeEach(() => {
    viewportState.isDesktop = false;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.mocked(useApi).mockReturnValue({
      data: homeDiscoveryPayload(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the taste hero on mobile instead of the old quick action buttons", () => {
    renderWithListenProviders(<Home />);

    expect(
      screen.getByRole("heading", { name: "Converge" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Play Radio/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^DNA$/i })).toBeNull();
  });
});
