import { useReducer } from "react";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
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

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(() => new Promise(() => {})),
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
    data: url === "/api/me/stats/today" ? (today ?? null) : dashboard,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
}

describe("Stats page", () => {
  it("shows freshness and the previous-period comparison from the dashboard", () => {
    const dashboard = signalDashboard();
    dashboard.snapshot = {
      built_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    dashboard.provisional = true;
    dashboard.overview.previous = {
      start: "2026-08-22",
      end: "2026-09-20",
      minutes_listened: 1710,
      play_count: 406,
      active_days: 27,
      artist_count: 10,
    };
    mockApis(dashboard);
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(
      screen.getByText("Updated 5 minutes ago · today still counting"),
    ).toBeVisible();
    expect(screen.getByText("vs previous 30 days")).toBeVisible();
    expect(screen.getAllByText("+100%").length).toBeGreaterThan(0);
  });

  it.each([
    [`/stats?window=year:${CURRENT_YEAR}`, "vs previous year"],
    ["/stats?window=365d", "vs previous year"],
    ["/stats?month=2026-09", "vs previous month"],
  ])("captions the comparison for %s as %s", (route, caption) => {
    const dashboard = signalDashboard();
    dashboard.overview.previous = {
      start: "2025-01-01",
      end: "2025-12-31",
      minutes_listened: 1710,
      play_count: 406,
      active_days: 27,
      artist_count: 10,
    };
    mockApis(dashboard);
    renderWithListenProviders(<Stats />, {
      route,
      path: "/stats",
      locale: "en",
    });
    expect(screen.getByText(caption)).toBeVisible();
    expect(screen.getAllByText("+100%").length).toBeGreaterThan(0);
  });

  it("reserves loading geometry without claiming zero activity or an empty library", () => {
    mockUseApi.mockImplementation(() => ({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    }));
    const { container } = renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(
      container.querySelector('[data-slot="skeleton-card"]'),
    ).not.toBeNull();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
  });

  it("offers retry after an uncached read failure instead of claiming no activity", async () => {
    const refetch = vi.fn();
    mockUseApi.mockImplementation(() => ({
      data: null,
      loading: false,
      error: "Internal request error",
      refetch,
    }));
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Internal request error"),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("keeps a cold pending snapshot loading until a real result is available", () => {
    const cold = {
      ...baseDashboard(),
      provisional: true,
      snapshot: { pending: true, version: 0 },
    };
    mockUseApi.mockImplementation(() => ({
      data: cold,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    function Fixture() {
      const [, refresh] = useReducer((value) => value + 1, 0);
      return (
        <>
          <button type="button" onClick={refresh}>
            Refresh fixture
          </button>
          <Stats />
        </>
      );
    }
    renderWithListenProviders(<Fixture />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(screen.getByTestId("loading-state")).toBeVisible();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    mockApis(signalDashboard());
    fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    expect(screen.queryByTestId("loading-state")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Converge" })).toBeVisible();
    mockApis({ ...baseDashboard(), snapshot: { pending: false, version: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    expect(screen.getByTestId("empty-state")).toBeVisible();
  });

  it("keeps the dashboard content, not the empty state, while a versioned empty snapshot is rebuilding", () => {
    const dashboard = signalDashboard();
    mockApis({
      ...dashboard,
      overview: { ...dashboard.overview, play_count: 0 },
      snapshot: { pending: true, version: 1 },
    });
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(
      screen.queryByText("Your stats are waiting for signal"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("loading-state")).toBeNull();
    expect(screen.getByRole("link", { name: "Converge" })).toBeVisible();
  });

  it("retains a cached dashboard during a failed refresh", () => {
    mockUseApi.mockImplementation(() => ({
      data: signalDashboard(),
      loading: false,
      error: "Refresh failed",
      refetch: vi.fn(),
    }));
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(screen.getByRole("link", { name: "Converge" })).toBeVisible();
    expect(
      screen.queryByText("Your stats are waiting for a signal"),
    ).not.toBeInTheDocument();
  });

  it("retains ranked entities while a cached dashboard refreshes", () => {
    const dashboard = signalDashboard();
    dashboard.top_artists.items = [
      {
        artist_id: 9,
        artist_name: "High Vis",
        artist_slug: "high-vis",
        play_count: 12,
        complete_play_count: 12,
        minutes_listened: 43,
      },
    ];
    mockUseApi.mockImplementation(() => ({
      data: dashboard,
      loading: true,
      error: null,
      refetch: vi.fn(),
    }));
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    expect(screen.getByRole("link", { name: /High Vis/ })).toBeVisible();
  });

  it("uses canonical uppercase mono captions throughout editorial metrics", () => {
    mockApis(signalDashboard());
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "en",
    });
    for (const key of [
      "Your artist of the period",
      "Longest streak",
      "Music age",
    ]) {
      expect(screen.getByText(key)).toHaveClass("font-mono", "uppercase");
    }
  });

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

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "30 días de señal",
    );
    expect(screen.getByRole("link", { name: "Crate DNA" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Crate Pulse" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.queryByRole("heading", { name: "Crate Digging" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Tus estadísticas esperan una señal"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("empty-state")).toHaveLength(1);
  });

  it("renders the explorer and every section of the redesigned page", () => {
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
      screen.getByRole("group", { name: "Escucha en el tramo seleccionado" }),
    ).toBeInTheDocument();
    expect(screen.getByText("minutos hoy")).toBeInTheDocument();
    expect(screen.getByText("artistas")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Crate Digging" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ver la historia" }),
    ).toHaveAttribute("href", "/stats/digging?window=30d");
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

    expect(
      screen.queryByRole("group", { name: "Escucha en el tramo seleccionado" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Top tracks")).toBeInTheDocument();
  });

  it.each([
    ["personal", "/stats", ["Hero", "Top Two", "Top Three"]],
    ["global", "/stats/global", []],
  ] as const)(
    "wires movement exclusions and scope on the %s page",
    (scope, route, _unused) => {
      void _unused;
      const dashboard = signalDashboard();
      const artist = (name: string) => ({
        artist_name: name,
        play_count: 5,
        minutes_listened: 20,
        complete_play_count: 5,
      });
      dashboard.artist_of_period = {
        ...dashboard.artist_of_period!,
        artist_name: "Hero",
      };
      dashboard.top_artists = {
        window: "30d",
        items: [
          artist("Top One"),
          artist("Top Two"),
          artist("Top Three"),
          artist("Top Four"),
        ],
      } as StatsDashboard["top_artists"];
      const signal = (name: string, delta?: number) => ({
        artist_name: name,
        play_count: 9,
        minutes_listened: 30,
        delta_play_count: delta,
      });
      dashboard.story = {
        ...dashboard.story!,
        movers: [
          signal("Hero", 9),
          signal("Top One", 8),
          signal("Top Three", 7),
          signal("Top Four", 6),
          signal("Fresh Riser", 5),
        ],
        discoveries: [signal("Fresh Face")],
        comebacks: [signal("Fresh Return")],
      };
      mockApis(dashboard);
      const { container } = renderWithListenProviders(<Stats />, {
        route,
        path: route,
        locale: "en",
      });
      const movement = container.querySelector("#movement") as HTMLElement;
      expect(movement).not.toBeNull();
      const inside = within(movement);
      for (const name of ["Hero", "Top One", "Top Three"]) {
        expect(inside.queryByText(name)).toBeNull();
      }
      expect(inside.getByText("Top Four")).toBeInTheDocument();
      expect(inside.getByText("Fresh Riser")).toBeInTheDocument();
      if (scope === "global") {
        expect(inside.queryByText("Fresh Face")).toBeNull();
        expect(inside.queryByText("Fresh Return")).toBeNull();
      } else {
        expect(inside.getByText("Fresh Face")).toBeInTheDocument();
        expect(inside.getByText("Fresh Return")).toBeInTheDocument();
      }
    },
  );

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

  it.each([
    ["personal", "/stats", "/stats", "/api/me/stats/range?"],
    ["global", "/stats/global", "/stats/global", "/api/stats/range?"],
    [
      "user",
      "/users/ana%20b/stats",
      "/users/:username/stats",
      "/api/users/ana%20b/stats/range?",
    ],
  ])(
    "renders the explorer for %s stats with their range endpoint",
    async (_scope, route, path, expected) => {
      vi.mocked(api).mockClear();
      mockApis(signalDashboard());
      renderWithListenProviders(<Stats />, { route, path, locale: "en" });
      expect(
        screen.getByRole("group", {
          name: "Listening in the selected stretch",
        }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(vi.mocked(api)).toHaveBeenCalledWith(
          expect.stringContaining(expected),
          "GET",
          undefined,
          expect.anything(),
        ),
      );
    },
  );
});
