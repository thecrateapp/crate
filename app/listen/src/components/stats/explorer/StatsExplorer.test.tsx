import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatsRange, StatsTape } from "@/components/stats/stats-types";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: apiMock,
}));

import { StatsExplorer } from "@/components/stats/explorer/StatsExplorer";
import { __resetStatsRangeCache } from "@/components/stats/explorer/use-stats-range";

const DAY = 86_400_000;
const BASE = "/api/me/stats/range";

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dailyTape(days = 92): StatsTape {
  const start = Date.UTC(2026, 6, 1);
  return {
    granularity: "day",
    start: iso(start),
    end: iso(start + days * DAY),
    points: Array.from({ length: days }, (_, index) => ({
      bucket: iso(start + index * DAY),
      minutes: index === 90 ? 0 : 30,
      plays: 6,
    })),
    mood: [],
    peaks: [],
    months: [],
  };
}

function payload(start: string, end: string): StatsRange {
  return {
    start,
    end,
    available: true,
    top_artists: [
      {
        artist_name: "Low",
        artist_id: 4,
        artist_slug: "low",
        minutes: 300,
        plays: 50,
        share: 0.3,
      },
    ],
    top_albums: [],
    top_tracks: [
      {
        track_id: 7,
        title: "Sunflower",
        artist: "Low",
        album: "Things We Lost in the Fire",
        album_id: 3,
        plays: 4,
        minutes: 16,
      },
    ],
    discoveries: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

describe("StatsExplorer", () => {
  beforeEach(() => {
    apiMock.mockReset();
    __resetStatsRangeCache();
    apiMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://crate.test").searchParams;
      return payload(params.get("start")!, params.get("end")!);
    });
  });

  it("fetches the stretch, opens a day and plays its track", async () => {
    const play = vi.fn();
    renderWithListenProviders(
      <StatsExplorer tape={dailyTape()} selection="90d" rangeEndpoint={BASE} />,
      { locale: "en", playerActions: { play } },
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${BASE}?start=2026-09-01&end=2026-09-30&limit=3`,
        "GET",
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(
      await screen.findByRole("region", { name: "Artist of the stretch" }),
    ).toHaveTextContent("Low");

    const chart = screen.getByRole("group", {
      name: "Listening in the selected stretch",
    });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(screen.getByText("Day in detail")).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${BASE}?start=2026-09-30&end=2026-09-30&limit=20`,
        "GET",
        undefined,
        expect.anything(),
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Play now" }));
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sunflower", libraryTrackId: 7 }),
      { type: "track", name: "Sunflower" },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Back to the stretch" }),
    );
    expect(screen.getByText("In this stretch")).toBeInTheDocument();
    expect(chart).toHaveFocus();
  });

  it("does not fetch silent days and follows month links", async () => {
    renderWithListenProviders(
      <>
        <StatsExplorer
          tape={dailyTape()}
          selection="90d"
          rangeEndpoint={BASE}
        />
        <LocationProbe />
      </>,
      { locale: "en", route: "/stats?window=90d" },
    );
    const chart = screen.getByRole("group", {
      name: "Listening in the selected stretch",
    });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(screen.getByText("Nothing played that day.")).toBeInTheDocument();
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(
      apiMock.mock.calls.some(([url]) => String(url).includes("limit=20")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("link", { name: "August 2026" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?month=2026-08");
  });
});
