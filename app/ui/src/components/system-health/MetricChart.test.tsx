import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MetricChart } from "./MetricChart";
import { metricStreams } from "./metric-stream-model";
const { charts } = vi.hoisted(() => ({
  charts: [] as Record<string, unknown>[],
}));
vi.mock("@nivo/line", () => ({
  ResponsiveLine: (props: Record<string, unknown>) => {
    charts.push(props);
    return null;
  },
}));
const data = [
  { timestamp: "2026-10-24T10:00:00Z", count: 0, avg: 1, max: 1 },
  { timestamp: "2026-10-24T10:03:00Z", count: 8, avg: 1, max: 1 },
];
describe("MetricChart", () => {
  it("keeps unchanged measurements out of unrelated parent renders", () => {
    const view = render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const renders = charts.length;
    view.rerender(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    expect(charts).toHaveLength(renders);
  });
  it("updates new measurements, granularity and availability", () => {
    const view = render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const renders = charts.length;
    const replacement = [{ ...data[0]!, count: 19 }];
    view.rerender(
      <MetricChart
        stream={metricStreams[1]!}
        data={replacement}
        intervalSeconds={3600}
        status={{ source: "postgresql_v2", availability: "stale" }}
      />,
    );
    expect(charts.length).toBeGreaterThan(renders);
    expect(charts[charts.length - 1]!.data).toMatchObject([
      { id: "count", data: [{ y: 19 }] },
    ]);
    expect(screen.getByText(/3,600 s buckets/)).toBeVisible();
    expect(screen.getByText("Source: PostgreSQL v2 · stale")).toBeVisible();
  });
  it("responds to motion availability without changed props", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      visibility.mockReturnValue("visible");
      render(
        <MetricChart
          stream={metricStreams[1]!}
          data={data}
          intervalSeconds={60}
        />,
      );
      expect(charts[charts.length - 1]!.animate).toBe(true);
      act(() => {
        visibility.mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(charts[charts.length - 1]!.animate).toBe(false);
      act(() => {
        visibility.mockReturnValue("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(charts[charts.length - 1]!.animate).toBe(true);
    } finally {
      visibility.mockRestore();
    }
  });
  it("draws real chronological positions without filled areas and exposes units/granularity", () => {
    render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const chart = charts[charts.length - 1]!;
    expect(chart.xScale).toMatchObject({ type: "linear" });
    expect(chart.enableArea).toBe(false);
    expect(chart.lineWidth).toBe(1.25);
    expect(
      screen.getByText(/requests per interval · 60 s buckets/),
    ).toBeVisible();
    expect(screen.getByText("Current bucket may be incomplete.")).toBeVisible();
  });
  it("selects measured zero by keyboard and keeps pointer/touch selection readable after dismissal", async () => {
    const user = userEvent.setup();
    render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const selector = screen.getByRole("combobox", {
      name: "Inspect Request Volume sample",
    });
    selector.focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("0")).toBeVisible();
    await user.click(selector);
    const missing = screen.getByRole("option", {
      name: /10:01:00.*No samples/,
    });
    fireEvent.pointerDown(missing, { pointerType: "touch" });
    await user.click(missing);
    expect(screen.getByText("No samples", { exact: true })).toBeVisible();
    expect(
      screen.getAllByText(/2026-10-24 10:01:00.000 UTC/).length,
    ).toBeGreaterThan(0);
  });
  it("never bridges a sparse gap even if Nivo omits null marks, and pins pointer selection", () => {
    const view = render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const chart = charts[charts.length - 1]!;
    const layer = (chart.layers as Array<unknown>)[2] as (
      props: unknown,
    ) => React.ReactNode;
    const points = [
      {
        data: { x: Date.parse(data[0]!.timestamp), y: 0 },
        position: { x: 0, y: 100 },
      },
      {
        data: { x: Date.parse(data[1]!.timestamp), y: 8 },
        position: { x: 300, y: 0 },
      },
    ];
    const drawing = render(
      <svg>
        {layer({
          series: [{ id: "count", data: points }],
          innerWidth: 300,
          innerHeight: 100,
          xScale: (x: number) => (x - points[0]!.data.x) / 600,
        })}
      </svg>,
    );
    expect(drawing.container.querySelectorAll("path")).toHaveLength(0);
    const target = drawing.container.querySelector(
      '[data-slot="metric-plot-interaction"]',
    )!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);
    fireEvent.click(target, { clientX: 0 });
    fireEvent.pointerLeave(target);
    expect(view.container).toHaveTextContent("2026-10-24 10:00:00.000 UTC");
    expect(screen.getByText("0")).toBeVisible();
  });
  it("resolves dense-sample plot interaction by nearest timestamp and spaces ticks by elapsed time", () => {
    const clustered = [
      data[0]!,
      { ...data[0]!, timestamp: "2026-10-24T10:01:00Z" },
      { ...data[0]!, timestamp: "2026-10-24T10:02:00Z" },
      { ...data[1]!, timestamp: "2026-10-24T11:00:00Z" },
    ];
    render(
      <MetricChart
        stream={metricStreams[1]!}
        data={clustered}
        intervalSeconds={60}
      />,
    );
    const chart = charts[charts.length - 1]!;
    expect((chart.axisBottom as { tickValues: number[] }).tickValues).toEqual([
      Date.parse("2026-10-24T10:00:00Z"),
      Date.parse("2026-10-24T10:30:00Z"),
      Date.parse("2026-10-24T11:00:00Z"),
    ]);
    const layer = (chart.layers as Array<unknown>)[2] as (
      props: unknown,
    ) => React.ReactNode;
    const points = clustered.slice(0, 3).map((sample, index) => ({
      data: { x: Date.parse(sample.timestamp), y: sample.count },
      position: { x: index * 10, y: 50 },
    }));
    const start = points[0]!.data.x;
    const drawing = render(
      <svg>
        {layer({
          series: [{ id: "count", data: points }],
          innerWidth: 100,
          innerHeight: 100,
          xScale: (x: number) => ((x - start) / 60000) * 10,
        })}
      </svg>,
    );
    const nodes = drawing.container.querySelector(
      '[data-slot="metric-visible-nodes"]',
    )!;
    const target = drawing.container.querySelector(
      '[data-slot="metric-plot-interaction"]',
    )!;
    expect(nodes.nextElementSibling).toBe(target);
    expect(nodes.querySelectorAll("circle")).toHaveLength(3);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    fireEvent.click(target, { clientX: 0 });
    expect(screen.getByText("0")).toBeVisible();
    expect(
      screen.getAllByText(/2026-10-24 10:00:00.000 UTC/).length,
    ).toBeGreaterThan(0);
    fireEvent.click(target, { clientX: 10 });
    expect(
      screen.getAllByText(/2026-10-24 10:01:00.000 UTC/).length,
    ).toBeGreaterThan(0);
  });
  it("dims unrelated marks during inspection while keeping missing buckets selectable", () => {
    render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const firstChart = charts[charts.length - 1]!;
    const draw = (chart: Record<string, unknown>) =>
      (chart.layers as Array<unknown>)[2] as (
        props: unknown,
      ) => React.ReactNode;
    const start = Date.parse(data[0]!.timestamp);
    const points = [
      { data: { x: start, y: 0 }, position: { x: 0, y: 50 } },
      { data: { x: start + 60000, y: null }, position: { x: 30, y: 50 } },
      { data: { x: start + 180000, y: 8 }, position: { x: 90, y: 10 } },
    ];
    const props = {
      series: [{ id: "count", data: points }],
      innerWidth: 90,
      innerHeight: 100,
      xScale: (x: number) => (x - start) / 2000,
    };
    const drawing = render(<svg>{draw(firstChart)(props)}</svg>);
    const target = drawing.container.querySelector(
      '[data-slot="metric-plot-interaction"]',
    )!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 90,
    } as DOMRect);
    fireEvent.click(target, { clientX: 30 });
    expect(screen.getByText("No samples", { exact: true })).toBeVisible();
    const latestChart = charts[charts.length - 1]!;
    drawing.rerender(<svg>{draw(latestChart)(props)}</svg>);
    expect(
      drawing.container.querySelectorAll('[data-muted="true"]'),
    ).toHaveLength(2);
    expect(
      drawing.container.querySelectorAll('[data-selected="true"]'),
    ).toHaveLength(0);
  });
  it("retains a valid pin, clears vanished selections and discards stale hover on replacement", async () => {
    const user = userEvent.setup();
    const view = render(
      <MetricChart
        stream={metricStreams[1]!}
        data={data}
        intervalSeconds={60}
      />,
    );
    const selector = () =>
      screen.getByRole("combobox", { name: "Inspect Request Volume sample" });
    selector().focus();
    await user.keyboard("{ArrowDown}{Enter}");
    const chart = charts[charts.length - 1]!;
    const layer = (chart.layers as Array<unknown>)[2] as (
      props: unknown,
    ) => React.ReactNode;
    const time = Date.parse(data[1]!.timestamp);
    const drawing = render(
      <svg>
        {layer({
          series: [
            {
              id: "count",
              data: [{ data: { x: time, y: 8 }, position: { x: 30, y: 30 } }],
            },
          ],
          innerWidth: 100,
          innerHeight: 100,
          xScale: (x: number) => (x - Date.parse(data[0]!.timestamp)) / 6000,
        })}
      </svg>,
    );
    const target = drawing.container.querySelector(
      '[data-slot="metric-plot-interaction"]',
    )!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    fireEvent.pointerMove(target, { clientX: 30 });
    expect(screen.getByText("8")).toBeVisible();
    view.rerender(
      <MetricChart
        stream={metricStreams[1]!}
        data={[...data]}
        intervalSeconds={60}
      />,
    );
    expect(screen.getByText("0")).toBeVisible();
    view.rerender(
      <MetricChart
        stream={metricStreams[1]!}
        data={[data[1]!]}
        intervalSeconds={60}
      />,
    );
    expect(selector()).toHaveTextContent("Inspect a sample");
    expect(screen.getByText("Select a sample")).toBeVisible();
    expect(screen.queryByText("0")).toBeNull();
  });
  it("preserves empty plot geometry and says no samples", () => {
    const { container } = render(
      <MetricChart
        stream={metricStreams[0]!}
        data={[]}
        intervalSeconds={3600}
      />,
    );
    expect(screen.getByText("No samples")).toBeVisible();
    expect(container.querySelector(".h-48")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
