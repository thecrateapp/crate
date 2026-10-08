import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type {
  StatsDashboard,
  StatsToday,
} from "@/components/stats/stats-model";

import { Stats } from "./Stats";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-lazy-crate-options", () => ({
  useLazyCrateOptions: () => ({
    crateOptions: [],
    ensureCrateOptionsLoaded: vi.fn(),
  }),
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({ isLiked: () => false, toggleTrackLike: vi.fn() }),
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({ isSaved: () => false, toggleAlbumSaved: vi.fn() }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(),
  }),
}));

const mockUseApi = vi.mocked(useApi);
const CURRENT_YEAR = new Date().getFullYear();

function baseDashboard(window = "30d"): StatsDashboard {
  return {
    window: window as StatsDashboard["window"],
    overview: {
      window: window as StatsDashboard["window"],
      play_count: 0,
      complete_play_count: 0,
      skip_count: 0,
      minutes_listened: 0,
      active_days: 0,
      skip_rate: 0,
      top_artist: null,
    },
    trends: { window: "30d", points: [] },
    top_tracks: { window: "30d", items: [] },
    top_artists: { window: "30d", items: [] },
    top_albums: { window: "30d", items: [] },
    top_genres: { window: "30d", items: [] },
    replay: {
      window: "30d",
      title: "Replay",
      subtitle: "Snapshot",
      track_count: 0,
      minutes_listened: 0,
      items: [],
    },
  };
}

function signalDashboard(): StatsDashboard {
  const dashboard = baseDashboard();
  dashboard.overview = {
    ...dashboard.overview,
    play_count: 812,
    minutes_listened: 3420,
    active_days: 27,
  };
  return {
    ...dashboard,
    timezone: "Europe/Madrid",
    provisional: true,
    metrics_version: "listening-v1",
    tape: {
      granularity: "day",
      start: "2026-09-09",
      end: "2026-10-09",
      points: Array.from({ length: 30 }, (_, index) => ({
        bucket: `2026-09-${String(9 + Math.min(index, 21)).padStart(2, "0")}`,
        minutes: 20 + index,
        plays: 5,
      })),
      mood: [
        { bucket: "2026-09-09", energy: 0.6, valence: 0.4 },
        { bucket: "2026-09-20", energy: 0.8, valence: 0.5 },
      ],
      peaks: [
        {
          kind: "obsession",
          bucket: "2026-09-14",
          day: "2026-09-14",
          value: 31,
          track: { title: "Spectral Wound", artist: "Black Curse" },
        },
      ],
      months: [
        { month: "2026-09", minutes: 900, plays: 210, top_artist: "Converge" },
      ],
    },
    highlights: {
      artist_count: 64,
      longest_streak: { days: 47, start: "2026-08-02", end: "2026-09-17" },
      current_streak: { days: 12 },
      new_artists: { count: 9, share: 0.21 },
      longest_session: {
        minutes: 400,
        started_at: "2026-09-05T18:00:00+00:00",
        track_count: 92,
      },
      obsession: {
        day: "2026-09-14",
        plays: 31,
        minutes: 120,
        track: {
          title: "Spectral Wound",
          artist: "Black Curse",
          album: "Burning",
        },
      },
    },
    artist_of_period: {
      artist_name: "Converge",
      listener_top_percent: 3,
      artist_id: 8,
      artist_slug: "converge",
      plays: 204,
      minutes: 720,
      active_days: 18,
      first_day_in_period: "2026-09-10",
      top_album: { album: "Jane Doe", plays: 80 },
    },
    heatmap: {
      cells: Array.from({ length: 7 }, (_, weekday) =>
        Array.from({ length: 24 }, (_, hour) =>
          weekday === 6 && hour === 22 ? 90 : 5,
        ),
      ),
      peak: { weekday: 6, hour: 22 },
      night_share: 0.38,
    },
    music_age: {
      median_year: 2009,
      decades: [
        { decade: 1990, share: 0.2 },
        { decade: 2000, share: 0.5 },
        { decade: 2010, share: 0.3 },
      ],
      oldest_album: { album: "When Forever Comes Crashing", year: 1998 },
    },
    genre_trend: [
      {
        genre_name: "Metalcore",
        slug: "metalcore",
        share: 0.34,
        delta_vs_previous: 0.09,
      },
    ],
    story: {
      window: "30d",
      movers: [],
      discoveries: [
        {
          artist_name: "Angine de Poitrine",
          play_count: 42,
          minutes_listened: 90,
          first_played_at: "2026-09-26T21:00:00+00:00",
        },
      ],
      comebacks: [],
      rhythm: { peak_hour_play_count: 0, peak_weekday_play_count: 0 },
      audio_profile: {
        energy: 0.79,
        danceability: 0.32,
        valence: 0.5,
        bpm: 137,
      },
      monthly_snapshots: [],
    },
  };
}

function mockApis(dashboard: StatsDashboard | null, today?: StatsToday) {
  mockUseApi.mockImplementation((url: string | null) => ({
    data: url === "/api/me/stats/today" ? today ?? null : dashboard,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
}

describe("Stats page", () => {
  beforeEach(() => {
    mockApis(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the dashboard while a snapshot is pending", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    mockUseApi.mockImplementation(() => ({
      data: { ...baseDashboard(), snapshot: { pending: true } },
      loading: false,
      error: null,
      refetch,
    }));

    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("localizes the header and shows a single empty state", () => {
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(screen.getByText("Tu sonido")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "30 días de señal",
    );
    expect(screen.getByText("Tu Crate DNA")).toBeInTheDocument();
    expect(screen.getByText("Crate Pulse")).toBeInTheDocument();
    expect(
      screen.getByText("Tus estadísticas esperan una señal"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("empty-state")).toHaveLength(1);
  });

  it("renders the signal tape and every section of the redesigned page", () => {
    mockApis(signalDashboard(), {
      day: "2026-10-08",
      timezone: "Europe/Madrid",
      minutes: 38,
      plays: 9,
    });

    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(
      screen.getByRole("group", { name: /de escucha en 30 barras/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("minutos hoy")).toBeInTheDocument();
    expect(screen.getByText("artistas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Converge" })).toBeInTheDocument();
    expect(screen.getByText("Tu artista del periodo")).toBeInTheDocument();
    expect(screen.getByText("top 3%")).toBeInTheDocument();
    expect(screen.getByText("de sus oyentes en Crate")).toBeInTheDocument();
    expect(screen.getByText("Racha más larga")).toBeInTheDocument();
    expect(screen.getAllByText("Spectral Wound").length).toBeGreaterThan(0);
    expect(screen.getByText("31×")).toBeInTheDocument();
    expect(screen.getByText("Cómo escuchas")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /22:00/ })).toBeInTheDocument();
    expect(screen.getByText(/ha crecido 9 puntos/)).toBeInTheDocument();
    expect(screen.getByText("2009")).toBeInTheDocument();
    expect(screen.getByText(/When Forever Comes Crashing/)).toBeInTheDocument();
    expect(screen.getByText("Angine de Poitrine")).toBeInTheDocument();
  });

  it("switches periods through the URL, including the calendar year", async () => {
    const user = userEvent.setup();
    mockApis(signalDashboard());

    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(screen.getByRole("radio", { name: "30 días" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: String(CURRENT_YEAR) }));

    await waitFor(() =>
      expect(mockUseApi).toHaveBeenCalledWith(
        expect.stringContaining(`window=year%3A${CURRENT_YEAR}`),
      ),
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `Tu ${CURRENT_YEAR} en señal`,
    );
  });

  it("keeps rendering legacy dashboards without the signal sections", () => {
    const legacy = baseDashboard();
    legacy.overview = {
      ...legacy.overview,
      play_count: 3,
      minutes_listened: 9,
    };
    mockApis(legacy);

    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByText("Top tracks")).toBeInTheDocument();
  });

  it("offers the rolling year instead of the calendar year for Crate Pulse", () => {
    mockApis(signalDashboard());

    renderWithListenProviders(<Stats />, {
      route: "/stats/global",
      path: "/stats/global",
      locale: "en",
    });

    expect(
      screen.getByRole("radio", { name: "Last year" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: String(CURRENT_YEAR) }),
    ).toBeNull();
    expect(mockUseApi).toHaveBeenCalledWith(null);
  });
});
