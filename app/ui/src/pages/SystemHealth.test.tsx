import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import dashboardFixture from "../../../../tests/admin-e2e/fixtures/metrics-dashboard.json";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { useApiMock, refetchMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/task-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-catalog")>();
  return { ...actual, useTaskCatalog: () => null };
});

import { SystemHealth } from "./SystemHealth";

const dashboard = { ...dashboardFixture, timeseries: {} };
const resourcesDescription =
  "Storage pressure, database pool use and analysis backlog surfaced as operational cards.";

describe("SystemHealth Resources instrument", () => {
  beforeEach(() => {
    useApiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: dashboard,
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("does not render an empty dashboard as healthy while metrics are loading", () => {
    useApiMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(
      screen.getByRole("status", { name: "Loading system health metrics" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Health Score")).not.toBeInTheDocument();
  });

  it("does not invent healthy or zero queue metrics when the response has no samples", () => {
    useApiMock.mockReturnValue({
      data: { ...dashboard, summary: null, timeseries: {} },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(screen.getByText("Health Score").parentElement).toHaveTextContent(
      "—",
    );
    expect(screen.getByText("— queued depth")).toBeVisible();
    expect(screen.queryByText("100% error rate")).not.toBeInTheDocument();
  });

  it("offers recovery for a cold dashboard error and retains stale data on refresh errors", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: null,
      loading: false,
      error: "network unavailable",
      refetch: refetchMock,
    });
    const view = renderWithAdminProviders(<SystemHealth />, {
      route: "/system",
    });
    const coldError = screen.getByRole("alert");
    expect(coldError).toHaveTextContent(
      "Could not load system health metrics.",
    );
    await user.click(within(coldError).getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledOnce();

    useApiMock.mockReturnValue({
      data: dashboard,
      loading: false,
      error: "network unavailable",
      refetch: refetchMock,
    });
    view.unmount();
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Showing the last successful sample.",
    );
    expect(screen.getByText("Health Score")).toBeVisible();
  });

  it("renders a named Resources figure with its heading, rule and description", () => {
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const panel = screen.getByRole("figure");
    expect(panel).toHaveAccessibleName("Music volume uses 280 of 1000 GB.");
    expect(panel).toHaveClass("border-t", "border-border-quiet", "@container");
    const heading = within(panel).getByRole("heading", {
      level: 2,
      name: "Resources",
    });
    expect(within(panel).getByText(resourcesDescription)).toBeInTheDocument();
    const header = heading.closest("header") ?? heading.parentElement;
    expect(header).not.toBeNull();
    expect(header?.querySelector("svg")).toBeNull();
  });

  it("preserves the resource cards and their actual measurements", () => {
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const panel = screen.getByRole("figure");
    for (const label of [
      "Music Volume",
      "Data Volume",
      "DB Pools",
      "Analysis",
    ]) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    for (const value of [
      "280 / 1000 GB",
      "720 GB free",
      "18 / 100 GB",
      "82 GB free",
      "2 / 8",
      "6 idle, 2 active",
      "851 / 863",
      "12 pending",
      "Bliss: 857 done, 6 pending",
    ]) {
      expect(within(panel).getByText(value)).toBeInTheDocument();
    }
  });

  it("uses the solid operational surface for resource and chart cards", () => {
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    for (const label of ["Music Volume", "API Latency"]) {
      const surface = screen.getByText(label).closest(".rounded-md");
      expect(surface).toHaveClass(
        "border-border-quiet",
        "bg-raised-surface",
        "shadow-none",
      );
      expect(surface?.className).not.toMatch(/backdrop-blur|bg-black\//);
    }
    const healthScore = screen.getByText("Health Score").closest(".rounded-md");
    expect(healthScore).toHaveClass("shadow-none");
  });

  it("retains the metrics window and refresh controls", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/metrics/dashboard?period=minute&minutes=60",
    );
    await user.click(screen.getByRole("radio", { name: "24h" }));
    expect(useApiMock).toHaveBeenLastCalledWith(
      "/api/admin/metrics/dashboard?period=hour&minutes=1440",
    );
    await user.click(screen.getByRole("button", { name: "Refresh metrics" }));
    expect(refetchMock).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("figure")).getByText("280 / 1000 GB"),
    ).toBeInTheDocument();
  });

  it("names the metrics window and supports arrow selection and a visible refresh action", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });
    const window = screen.getByRole("radiogroup", { name: "Metrics window" });
    const hour = within(window).getByRole("radio", { name: "1h" });
    expect(hour).toHaveAttribute("aria-checked", "true");
    await user.click(hour);
    await user.keyboard("{ArrowRight}");
    expect(within(window).getByRole("radio", { name: "24h" })).toHaveFocus();
    expect(useApiMock).toHaveBeenLastCalledWith(
      "/api/admin/metrics/dashboard?period=hour&minutes=1440",
    );
    await user.keyboard("{ArrowLeft}");
    expect(hour).toHaveFocus();
    expect(useApiMock).toHaveBeenLastCalledWith(
      "/api/admin/metrics/dashboard?period=minute&minutes=60",
    );
    const refresh = screen.getByRole("button", { name: "Refresh metrics" });
    expect(refresh).toHaveAccessibleName("Refresh metrics");
    expect(refresh).not.toHaveAttribute("title");
    expect(refresh.textContent).toBe("");
    await user.click(refresh);
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  it("keeps named measurements and instrument data while retiring page glyphs", () => {
    useApiMock.mockReturnValue({
      data: {
        ...dashboard,
        playback_delivery: {
          ...dashboard.playback_delivery,
          runtime: { active: 1, limit: 3 },
        },
        tasks: [
          {
            id: "sample-system-task",
            type: "sync_library",
            status: "running",
            created_at: "2026-10-18T10:00:00Z",
            progress: '{"done":3,"total":12}',
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    const { container } = renderWithAdminProviders(<SystemHealth />, {
      route: "/system",
    });
    expect(container.querySelectorAll("svg.lucide")).toHaveLength(1);
    expect(container.querySelector("svg.lucide")).toHaveAttribute(
      "data-admin-ux",
      "header-refresh-metrics",
    );
    const score = screen.getByText("Health Score").parentElement!;
    expect(score).toHaveClass("crate-form-field");
    expect(score.children[0]).toHaveTextContent("Health Score");
    expect(score.children[1]).toHaveTextContent("100");
    expect(score.children[1]).toHaveClass("font-mono", "tabular-nums");
    const volume = screen.getByText("Music Volume").parentElement!;
    expect(volume).toHaveClass("crate-form-field");
    expect(volume.children[1]).toHaveTextContent("280 / 1000 GB");
    expect(screen.getByText("Elapsed", { exact: true })).toHaveTextContent(
      /Elapsed.*\d/,
    );
  });

  it("does not invent a Resources figure while the system payload is absent", () => {
    useApiMock.mockReturnValue({
      data: { ...dashboard, system: null },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Resources" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "System Health" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh metrics" }),
    ).toBeInTheDocument();
  });

  it("keeps a concise playback signal and links to its dedicated page", () => {
    useApiMock.mockReturnValue({
      data: {
        ...dashboard,
        playback_delivery: {
          ...dashboard.playback_delivery,
          stats: {
            ...dashboard.playback_delivery.stats,
            coverage_percent: 82,
            ready_tracks: 410,
          },
          runtime: { active: 3, limit: 5 },
        },
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    expect(screen.getByText("82% lossless coverage")).toBeVisible();
    expect(screen.getByText("410 tracks ready")).toBeVisible();
    expect(screen.getByText("3/5 transcodes")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open playback delivery" }),
    ).toHaveAttribute("href", "/playback");
    expect(
      screen.queryByRole("meter", { name: "Transcode slots" }),
    ).not.toBeInTheDocument();
  });
});
