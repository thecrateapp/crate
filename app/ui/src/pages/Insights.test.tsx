vi.mock("@crate/ui/lib/read-css-color", () => ({
  readCssColorToken: (element: HTMLElement, token: string) =>
    getComputedStyle(element).getPropertyValue(token).trim() || "#111111",
}));
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refetchMock, useApiMock, charts, motionMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  charts: [] as Record<string, unknown>[],
  motionMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

vi.mock("@crate/ui/lib/motion-gate", () => ({ useMotionAllowed: motionMock }));
vi.mock("@nivo/bar", () => ({
  ResponsiveBar: (props: Record<string, unknown>) => {
    charts.push(props);
    return null;
  },
}));
vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlot: (props: Record<string, unknown>) => {
    charts.push(props);
    return null;
  },
}));

import { Insights } from "./Insights";

const insightData = {
  countries: { Spain: 20 },
  bpm_distribution: [],
  energy_danceability: [],
  top_genres: [{ genre: "post-metal", artists: 8, albums: 21 }],
  popularity: [
    {
      artist: "Caspian",
      popularity: 76,
      listeners: 80000,
      albums: 6,
    },
  ],
  albums_by_decade: { "2020s": 24 },
  top_albums: [],
  acoustic_instrumental: [],
  feature_coverage: [],
  artist_depth: [],
};

describe("Insights refresh recovery", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    charts.length = 0;
    motionMock.mockReturnValue(true);
    useApiMock.mockReturnValue({
      data: insightData,
      loading: false,
      error: "Snapshot refresh failed",
      refetch: refetchMock,
    });
  });

  it.each([false, true])(
    "passes motion availability %s to every bar and scatter plot",
    (allowed) => {
      motionMock.mockReturnValue(allowed);
      useApiMock.mockReturnValue({
        data: {
          ...insightData,
          bpm_distribution: [{ bpm: "120", count: 3 }],
          energy_danceability: [
            { x: 0.8, y: 0.4, artist: "Caspian", title: "Track" },
          ],
          acoustic_instrumental: [
            { x: 0.1, y: 0.9, artist: "Caspian", title: "Track" },
          ],
          top_albums: [
            {
              album: "Dust",
              artist: "Caspian",
              listeners: 8,
              popularity: 70,
              year: "2025",
            },
          ],
          feature_coverage: [{ feature: "tempo", value: 3, total: 4 }],
          artist_depth: [
            {
              artist: "Caspian",
              popularity: 70,
              listeners: 100,
              albums: 6,
              tracks: 40,
            },
          ],
        },
        loading: false,
        error: null,
        refetch: refetchMock,
      });
      render(<Insights />);
      expect(charts).toHaveLength(10);
      for (const chart of charts) expect(chart.animate).toBe(allowed);
    },
  );

  it("keeps the last successful charts visible and offers a retry after refresh fails", async () => {
    const user = userEvent.setup();
    const { container } = render(<Insights />);

    expect(screen.getByRole("heading", { name: "Insights" })).toBeVisible();
    for (const label of ["Collection shape", "Standouts", "Audio signature"]) {
      expect(
        screen
          .getAllByText(label, { exact: true })
          .some((element) => element.closest('[data-slot="info-badge"]')),
      ).toBe(true);
    }
    expect(
      screen.getByText(
        "Insights could not refresh. Showing the last successful snapshot.",
      ),
    ).toBeVisible();
    expect(screen.getByText("post-metal")).toBeVisible();
    expect(screen.queryByText("Signal Brief")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll("article")).some((article) =>
        article.className.includes("bg-raised-surface"),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});

it("keeps homonymous and common-prefix albums distinct in the chart scale", () => {
  charts.length = 0;
  useApiMock.mockReturnValue({
    data: {
      ...insightData,
      top_albums: [
        {
          album: "Greatest Hits",
          artist: "Artist A",
          listeners: 1,
          popularity: 10,
          year: "2020",
        },
        {
          album: "Greatest Hits",
          artist: "Artist B",
          listeners: 2,
          popularity: 20,
          year: "2021",
        },
        {
          album: "A very long common album prefix One",
          artist: "Artist C",
          listeners: 3,
          popularity: 30,
          year: "2022",
        },
        {
          album: "A very long common album prefix Two",
          artist: "Artist C",
          listeners: 4,
          popularity: 40,
          year: "2023",
        },
      ],
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
  render(<Insights />);
  const chart = charts.find((item) =>
    (item.data as Array<{ fullAlbum?: string }>)?.some(
      (row) => row.fullAlbum === "Greatest Hits",
    ),
  )!;
  const data = chart.data as Array<Record<string, unknown>>;
  expect(new Set(data.map((row) => row[String(chart.indexBy)])).size).toBe(4);
  expect(data.map((row) => row.fullAlbum)).toContain(
    "A very long common album prefix Two",
  );
});
it("takes chart colors from current semantic tokens", () => {
  charts.length = 0;
  document.documentElement.style.setProperty("--accent-action-hi", "#123456");
  document.documentElement.style.setProperty("--text-secondary", "#abcdef");
  render(<Insights />);
  expect(
    charts.every((chart) =>
      (chart.colors as string[]).some(
        (color) => color === "#123456" || color === "#abcdef",
      ),
    ),
  ).toBe(true);
  document.documentElement.removeAttribute("style");
});
