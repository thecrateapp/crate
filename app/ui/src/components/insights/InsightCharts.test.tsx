import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
vi.mock("@crate/ui/lib/read-css-color", () => ({
  readCssColorToken: () => "#123456",
}));
// Use real Nivo scales/layers at deterministic dimensions; ResizeObserver is a browser concern.
vi.mock("@nivo/scatterplot", async (original) => {
  const actual = await original<typeof import("@nivo/scatterplot")>();
  return {
    ...actual,
    ResponsiveScatterPlot: (
      props: ComponentProps<typeof actual.ScatterPlot>,
    ) => <actual.ScatterPlot {...props} width={400} height={104} />,
  };
});
vi.mock("@nivo/line", async (original) => {
  const actual = await original<typeof import("@nivo/line")>();
  return {
    ...actual,
    ResponsiveLine: (props: ComponentProps<typeof actual.Line>) => (
      <actual.Line {...props} width={400} height={208} />
    ),
  };
});
import { InsightComparison } from "./InsightComparison";
import { InsightTimeline } from "./InsightTimeline";
import type { CollectionInsights } from "./insights-model";
const row = {
  key: "unknown",
  label: "Unknown genre",
  genre_slug: null,
  tracks: 1,
  albums: 1,
  played_tracks: 1,
  plays: 1,
  minutes: 10,
  catalogue_share: 100,
  listening_share: 100,
  previous_listening_share: 0,
  examples: [],
};
const data: CollectionInsights = {
  ready: true,
  window: "30d",
  period: {
    start: "2026-09-25",
    end: "2026-10-24",
    previous_start: "2026-08-26",
    previous_end: "2026-09-24",
    history_start: "2026-04-06",
    calendar: "listener_local_days",
    previous_complete: true,
    history_complete: true,
  },
  catalogue: { tracks: 1, albums: 1 },
  current: {
    plays: 1,
    minutes: 10,
    tracks: 1,
    albums: 1,
    concentration_pct: 100,
  },
  previous: {
    plays: 0,
    minutes: 0,
    tracks: 0,
    albums: 0,
    concentration_pct: null,
  },
  excluded: { plays: 0, minutes: 0 },
  timeline: [
    { day: "2026-09-25", minutes: 0, previous_minutes: 0 },
    { day: "2026-09-26", minutes: 10, previous_minutes: 0 },
  ],
  genres: [
    row,
    {
      ...row,
      key: "other",
      label: "Other",
      catalogue_share: 0,
      listening_share: 0,
    },
  ],
  decades: [],
  rising: [],
  falling: [],
  unheard: { total: 0, items: [] },
  rediscover: { total: 0, items: [] },
  improvements: [],
};
describe("Insights Nivo geometry", () => {
  it("uses one scale for coincident catalogue and listening endpoints", () => {
    const { container } = render(
      <MemoryRouter>
        <InsightComparison data={data} />
      </MemoryRouter>,
    );
    const rails = container.querySelectorAll(
      '[data-admin-instrument="insights-comparison-rails"] line',
    );
    expect(rails).toHaveLength(2);
    expect(rails[0]!.getAttribute("x1")).toBe(rails[0]!.getAttribute("x2"));
    expect(container.querySelectorAll(".instrument-chart-point")).toHaveLength(
      4,
    );
    expect(
      screen.getByRole("button", { name: /Inspect Unknown genre/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("draws current and previous time geometry with dashed prior and accessible persistent reading", () => {
    const { container } = render(<InsightTimeline data={data} />);
    const paths = container.querySelectorAll(
      '[data-admin-instrument="insights-listening-trace"] path',
    );
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute("d", expect.stringContaining("M"));
    expect(paths[1]).toHaveAttribute("stroke-dasharray", "3 5");
    expect(
      screen.getByRole("slider", { name: "Inspect listening day" }),
    ).toHaveAttribute("aria-valuetext", expect.stringContaining("10 min"));
  });
  it("omits the prior trace entirely when the prior history is incomplete", () => {
    const incomplete = {
      ...data,
      period: { ...data.period!, previous_complete: false },
    };
    const { container } = render(<InsightTimeline data={incomplete} />);
    expect(
      container.querySelectorAll(
        '[data-admin-instrument="insights-listening-trace"] path',
      ),
    ).toHaveLength(1);
    expect(screen.queryByText("Previous relative day")).not.toBeInTheDocument();
  });
  it.each([
    { period: "Selected period", y: 0, day: "2026-09-26", time: "10 min" },
    { period: "Previous period", y: 136, day: "2026-08-27", time: "2 min" },
  ])(
    "names the date and listening time in the $period hover reading",
    async ({ period, y, day, time }) => {
      const { container } = render(
        <InsightTimeline
          data={{
            ...data,
            timeline: [
              data.timeline[0]!,
              { ...data.timeline[1]!, previous_minutes: 2 },
            ],
          }}
        />,
      );
      const mesh = container.querySelector('[data-ref="mesh-interceptor"]')!;
      fireEvent.mouseEnter(mesh, { clientX: 348, clientY: y });
      fireEvent.mouseMove(mesh, { clientX: 348, clientY: y });
      const tooltip = await screen.findByRole("group", {
        name: `${period} listening`,
      });
      // Nivo positions its tooltip after ResizeObserver measurement, absent in jsdom.
      expect(within(tooltip).getByText("Reported day")).toBeInTheDocument();
      expect(within(tooltip).getByText(day)).toBeInTheDocument();
      expect(within(tooltip).getByText("Registered time")).toBeInTheDocument();
      expect(within(tooltip).getByText(time)).toBeInTheDocument();
      expect(tooltip).not.toHaveTextContent(/\bx:|\by:/i);
    },
  );
});

it("spreads low-share genres over one explicit percentage scale while preserving absolute shares", () => {
  const low = {
    ...data,
    genres: [
      {
        ...row,
        key: "first",
        label: "First",
        catalogue_share: 5,
        listening_share: 12.5,
      },
      {
        ...row,
        key: "second",
        label: "Second",
        catalogue_share: 12.5,
        listening_share: 6,
      },
    ],
  };
  const { container } = render(
    <MemoryRouter>
      <InsightComparison data={low} />
    </MemoryRouter>,
  );
  expect(screen.getByText("15%")).toBeVisible();
  const rails = container.querySelectorAll(
    '[data-admin-instrument="insights-comparison-rails"] line',
  );
  const firstListening = Number(rails[0]!.getAttribute("x2"));
  const secondCatalogue = Number(rails[1]!.getAttribute("x1"));
  expect(firstListening).toBeGreaterThan(300);
  // The visible endpoint is 15%, so 12.5% must occupy precisely 12.5/15 of
  // the 388px inner scale; Nivo must not silently nice the domain to 16.
  expect(firstListening).toBeCloseTo((12.5 / 15) * (400 - 6 - 6), 5);
  expect(firstListening).toBe(secondCatalogue);
  expect(
    Math.abs(firstListening - Number(rails[0]!.getAttribute("x1"))),
  ).toBeGreaterThan(100);
  expect(
    screen.getByRole("button", {
      name: /Inspect First: catalogue 5%, listening 12.5%/,
    }),
  ).toBeVisible();
});
it("keeps a finite percentage scale for zero shares", () => {
  const zero = {
    ...data,
    genres: data.genres.map((item) => ({
      ...item,
      catalogue_share: 0,
      listening_share: 0,
    })),
  };
  const { container } = render(
    <MemoryRouter>
      <InsightComparison data={zero} />
    </MemoryRouter>,
  );
  for (const rail of container.querySelectorAll(
    '[data-admin-instrument="insights-comparison-rails"] line',
  )) {
    expect(Number.isFinite(Number(rail.getAttribute("x1")))).toBe(true);
    expect(Number.isFinite(Number(rail.getAttribute("x2")))).toBe(true);
  }
});

it("keeps 25 categories and their plotted geometry in one bounded scroll viewport with the scale outside", () => {
  const many = {
    ...data,
    genres: Array.from({ length: 25 }, (_, index) => ({
      ...row,
      key: `category-${index}`,
      label: `Category ${index + 1}`,
      catalogue_share: 5,
      listening_share: 12.5,
    })),
  };
  const { container } = render(
    <MemoryRouter>
      <InsightComparison data={many} />
    </MemoryRouter>,
  );
  const viewport = screen.getByRole("region", {
    name: "Collection category rows",
  });
  expect(viewport).toHaveClass(
    "max-h-80",
    "lg:max-h-[32rem]",
    "overflow-y-auto",
  );
  expect(viewport.querySelectorAll("button")).toHaveLength(25);
  expect(
    viewport.querySelector(
      '[data-admin-instrument="insights-comparison-rails"]',
    ),
  ).not.toBeNull();
  expect(viewport.previousElementSibling).toHaveTextContent("0%");
  expect(viewport.previousElementSibling).toHaveTextContent("15%");
  const last = screen.getByRole("button", { name: /Inspect Category 25:/ });
  expect(last).toHaveClass("h-[52px]");
  act(() => last.focus());
  expect(last).toHaveFocus();
  expect(
    container.querySelector('[aria-label="Selected collection category"]'),
  ).toHaveTextContent("Category 25");
  expect(screen.getByText(/25 categories shown · Select a row/)).toBeVisible();
});
