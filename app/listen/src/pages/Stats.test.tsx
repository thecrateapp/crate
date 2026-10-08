import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type {
  StatsDashboard,
  StatsToday,
} from "@/components/stats/stats-model";
import { baseDashboard, signalDashboard } from "@/test/stats-dashboard-fixture";

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
