import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dashboardFixture from "../../../../tests/admin-e2e/fixtures/metrics-dashboard.json";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { useApiMock, refetchMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  refetchMock: vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@crate/ui/lib/motion-gate", () => ({ useMotionAllowed: () => false }));
vi.mock("@nivo/line", () => ({ ResponsiveLine: () => null }));
vi.mock("@/lib/task-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-catalog")>();
  return { ...actual, useTaskCatalog: () => null };
});

import { SystemHealth } from "./SystemHealth";

function freshDashboard() {
  const snapshot = structuredClone(dashboardFixture);
  const observed = new Date().toISOString();
  snapshot.summary._meta.generated_at = observed;
  snapshot.summary._meta.collector_local.observed_at = observed;
  snapshot.summary._meta.collector_local.last_write_at = observed;
  for (const metric of Object.values(snapshot.summary)) {
    if ("count" in metric) {
      metric.observed_at = observed;
      metric.age_seconds = 0;
    }
  }
  for (const status of Object.values(snapshot.timeseries_status)) {
    if (status.observed_at) status.observed_at = observed;
  }
  return snapshot;
}

function show(
  snapshot: ReturnType<typeof freshDashboard>,
  error: string | null = null,
) {
  useApiMock.mockReturnValue({
    data: snapshot,
    loading: false,
    error,
    refetch: refetchMock,
  });
  return renderWithAdminProviders(<SystemHealth />, { route: "/system" });
}

function signal(label: string) {
  const summary = screen
    .getByText("Health Score", { exact: true })
    .closest<HTMLElement>('[data-slot="system-health-summary"]')!;
  return within(summary).getByText(label, { exact: true }).parentElement!;
}

function showHistory(snapshot: ReturnType<typeof freshDashboard>) {
  const live = freshDashboard();
  useApiMock.mockImplementation((url: string) => ({
    data: url.includes("period=hour") ? snapshot : live,
    loading: false,
    error: null,
    refetch: refetchMock,
  }));
  renderWithAdminProviders(<SystemHealth />, { route: "/system" });
  fireEvent.click(screen.getByRole("radio", { name: "24h" }));
}

describe("SystemHealth collection provenance", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    refetchMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not certify an unverified legacy summary as healthy", () => {
    const snapshot = freshDashboard();
    Reflect.deleteProperty(snapshot.summary, "_meta");
    for (const metric of Object.values(snapshot.summary)) {
      if (!("count" in metric)) continue;
      for (const field of [
        "availability",
        "reason",
        "source",
        "observed_at",
        "age_seconds",
        "window_minutes",
        "sample_count",
        "eligible_count",
        "sample_kind",
      ])
        Reflect.deleteProperty(metric, field);
    }

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(signal("API max").children[1]).toHaveTextContent("—");
    expect(
      screen.queryByText(/Core services look stable/i),
    ).not.toBeInTheDocument();
  });

  it("shows unavailable collection as unknown instead of a healthy zero", () => {
    const snapshot = freshDashboard();
    for (const metric of Object.values(snapshot.summary)) {
      if (!("count" in metric)) continue;
      Object.assign(metric, {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        availability: "unavailable",
        reason: "redis_unavailable",
        sample_count: 0,
        eligible_count: 0,
      });
    }

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(
      within(signal("API max")).queryByText("0ms"),
    ).not.toBeInTheDocument();
    expect(signal("Error Rate").children[1]).toHaveTextContent("—");
    expect(signal("Slow Requests").children[1]).toHaveTextContent("—");
  });

  it("does not treat a successful empty read as evidence of zero error rate", () => {
    const snapshot = freshDashboard();
    Object.assign(snapshot.summary.api_requests, {
      count: 0,
      sample_count: 0,
      eligible_count: 0,
      availability: "empty",
    });
    Object.assign(snapshot.summary.api_errors, {
      count: 0,
      sample_count: 0,
      eligible_count: 0,
      availability: "empty",
    });

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(signal("Error Rate").children[1]).toHaveTextContent("—");
  });

  it("keeps a partial latency sample out of the current healthy score", () => {
    const snapshot = freshDashboard();
    snapshot.summary.api_latency.availability = "partial";

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(
      screen.queryByText(/Core services look stable/i),
    ).not.toBeInTheDocument();
  });

  it("does not let fresh API samples certify a stale queue from an older chart bucket", () => {
    const snapshot = freshDashboard();
    const previous = new Date(Date.now() - 30 * 60_000).toISOString();
    Object.assign(snapshot.summary.worker_queue_depth, {
      availability: "stale",
      observed_at: previous,
      age_seconds: 1800,
    });
    Object.assign(snapshot.timeseries, {
      "worker.queue.depth": [
        { timestamp: previous, count: 1, min: 0, max: 0, sum: 0, avg: 0 },
      ],
    });

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(screen.getByText("— queued depth")).toBeVisible();
    expect(screen.queryByText("0 queued depth")).not.toBeInTheDocument();
  });

  it("shows the latest queued depth instead of the window maximum", () => {
    const snapshot = freshDashboard();
    Object.assign(snapshot.summary.worker_queue_depth, { max: 40, latest: 3 });

    show(snapshot);

    expect(screen.getByText("3 queued depth")).toBeVisible();
    expect(screen.queryByText("40 queued depth")).not.toBeInTheDocument();
  });

  it("exposes known losses in the local collector instead of certifying fresh samples", () => {
    const snapshot = freshDashboard();
    Object.assign(snapshot.summary._meta.collector_local, {
      availability: "partial",
      last_error_at: new Date().toISOString(),
      counters: { buffer_full: 3, redis_error: 0, invalid_observation: 0 },
    });

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(screen.getByText(/3\s+(?:discarded|dropped)/i)).toBeVisible();
    expect(
      screen.getAllByText(/local.*process|process.*local/i).length,
    ).toBeGreaterThan(0);
  });

  it("does not present retained data as current health after a refresh failure", () => {
    show(freshDashboard(), "network unavailable");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Showing the last successful sample.",
    );
    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(
      screen.queryByText(/Core services look stable/i),
    ).not.toBeInTheDocument();
  });

  it("expires a once-fresh sample while the page stays open without a response", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T16:00:00.000Z"));
    show(freshDashboard());
    expect(signal("Health Score").children[1]).toHaveTextContent("100");

    act(() => {
      vi.advanceTimersByTime(315_000);
    });

    expect(signal("Health Score").children[1]).toHaveTextContent("—");
    expect(
      screen.queryByText(/Core services look stable/i),
    ).not.toBeInTheDocument();
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it("accepts an observed zero error numerator with an explicit eligible population", () => {
    const snapshot = freshDashboard();
    Object.assign(snapshot.summary.api_errors, {
      count: 0,
      sample_count: 0,
      eligible_count: 120,
      availability: "available",
    });

    show(snapshot);

    expect(signal("Health Score").children[1]).toHaveTextContent("100");
    expect(signal("Error Rate").children[1]).toHaveTextContent("0.00%");
    expect(signal("Health Score").parentElement).toHaveTextContent(/observed/i);
    expect(
      screen.queryByText(/Core services look stable/i),
    ).not.toBeInTheDocument();
  });

  it("declares the persisted PostgreSQL source and retention for a 24-hour chart", () => {
    const snapshot = freshDashboard();
    const observed = new Date(Date.now() - 120_000).toISOString();
    Object.assign(snapshot.timeseries_status["api.latency"], {
      source: "postgresql_v2",
      availability: "available",
      observed_at: observed,
      age_seconds: 120,
      reason: null,
    });

    showHistory(snapshot);

    const chart = screen.getByRole("region", {
      name: "API Latency",
    });
    expect(chart).toHaveTextContent(/PostgreSQL v2/i);
    expect(chart).toHaveTextContent(observed);
    const provenance = screen.getByRole("status", {
      name: "Metrics provenance",
    });
    expect(provenance).toHaveTextContent(/Corrected collection since/i);
    expect(provenance).toHaveTextContent(/Minute history retains 8 days/i);
    expect(signal("API max").children[1]).toHaveTextContent("48ms");
  });

  it("does not label failed PostgreSQL history as no activity or hide current API samples", () => {
    const snapshot = freshDashboard();
    snapshot.timeseries["api.latency"] = [];
    Object.assign(snapshot.timeseries_status["api.latency"], {
      source: "postgresql_v2",
      availability: "unavailable",
      observed_at: null,
      age_seconds: null,
      reason: "postgres_unavailable",
    });

    showHistory(snapshot);

    const chart = screen.getByRole("region", {
      name: "API Latency",
    });
    expect(chart).toHaveTextContent(/PostgreSQL v2/i);
    expect(chart).toHaveTextContent(/unavailable/i);
    expect(
      within(chart).queryByText("No samples", { exact: true }),
    ).not.toBeInTheDocument();
    expect(signal("API max").children[1]).toHaveTextContent("48ms");
    expect(signal("Health Score").children[1]).toHaveTextContent("100");
  });

  it("uses a supplied Redis source without assuming it when metadata is missing", () => {
    const snapshot = freshDashboard();
    snapshot.timeseries_status["api.latency"].source = "redis_v2";
    const view = show(snapshot);
    const chart = () => screen.getByRole("region", { name: "API Latency" });
    expect(chart()).toHaveTextContent(/Redis v2/i);
    view.unmount();
    Reflect.deleteProperty(snapshot, "timeseries_status");

    show(snapshot);

    expect(chart()).toHaveTextContent(/unverified/i);
    expect(chart()).not.toHaveTextContent(/Source: Redis v2/i);
  });
});
