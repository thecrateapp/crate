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
    expect(refresh).toHaveTextContent("Refresh metrics");
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
    expect(container.querySelector("svg.lucide")).toBeNull();
    const score = screen.getByText("Health Score").parentElement!;
    expect(score).toHaveClass("crate-form-field");
    expect(score.children[0]).toHaveTextContent("Health Score");
    expect(score.children[1]).toHaveTextContent("100");
    expect(score.children[1]).toHaveClass("font-display");
    const volume = screen.getByText("Music Volume").parentElement!;
    expect(volume).toHaveClass("crate-form-field");
    expect(volume.children[1]).toHaveTextContent("280 / 1000 GB");
    expect(
      screen.getByRole("meter", { name: "Transcode Slots" }),
    ).toHaveAttribute("aria-valuenow", "1");
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

  it("uses actual playback worker activity and capacity for the transcoding meter", () => {
    useApiMock.mockReturnValue({
      data: {
        ...dashboard,
        playback_delivery: {
          ...dashboard.playback_delivery,
          runtime: { active: 3, limit: 5 },
        },
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const meter = screen.getByRole("meter", { name: "Transcode Slots" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/3\s*\/\s*5/),
    );
  });

  it("keeps an oversubscribed worker measurement in text while clamping its accessible range", () => {
    useApiMock.mockReturnValue({
      data: {
        ...dashboard,
        playback_delivery: {
          ...dashboard.playback_delivery,
          runtime: { active: 5, limit: 4 },
        },
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
    renderWithAdminProviders(<SystemHealth />, { route: "/system" });

    const meter = screen.getByRole("meter", { name: /Transcode Slots.*over/ });
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(meter).toHaveAttribute("aria-valuemax", "4");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/5\s*\/\s*4/),
    );
    expect(screen.getByText("over · max 4")).toBeInTheDocument();
  });

  it.each([undefined, { active: 0 }, { limit: 4 }])(
    "does not invent playback capacity when the runtime is incomplete (%j)",
    (runtime) => {
      useApiMock.mockReturnValue({
        data: {
          ...dashboard,
          playback_delivery: { ...dashboard.playback_delivery, runtime },
        },
        loading: false,
        error: null,
        refetch: refetchMock,
      });
      renderWithAdminProviders(<SystemHealth />, { route: "/system" });

      const unavailable = screen.getByRole("group", {
        name: "Transcode Slots",
      });
      expect(unavailable).toHaveAccessibleDescription("n/a");
      expect(unavailable).not.toHaveAttribute("aria-valuenow");
      expect(
        screen.queryByRole("meter", { name: "Transcode Slots" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("0/1", { exact: true }),
      ).not.toBeInTheDocument();
    },
  );
});
